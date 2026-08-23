import { Platform, PermissionsAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Print over the printer's *existing* Bluetooth pairing — the same one Wolt
 * and Uber Eats already use — rather than requiring the printer on the
 * restaurant's network.
 *
 * This only exists because the till device is Android. Classic Bluetooth
 * (SPP/RFCOMM, what thermal printers speak) has no public API on iOS outside
 * MFi-certified accessories, so this path is Android-only by platform limit,
 * not by choice. It also inherits the same constraint Wolt/Uber already have:
 * classic Bluetooth holds one connection at a time, so DishData, Wolt and
 * Uber are still taking turns on the printer, just with a third app added to
 * the rotation. Prefer the network printer (printing.ts) when the printer has
 * an IP — it doesn't have either limitation.
 *
 * The chosen printer is a LOCAL, per-device setting (AsyncStorage), not
 * org.settings like the network printer config: a Bluetooth pairing is a
 * property of *this tablet*, not of the restaurant, so it can't be shared
 * across devices the way an IP address can.
 */

const DEVICE_KEY = "dishdata.bluetoothPrinter.v1";
const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://app.dishdata.de";

export interface BluetoothPrinterDevice {
  name: string;
  address: string;
}

export function bluetoothPrintingSupported(): boolean {
  return Platform.OS === "android";
}

/**
 * Android 12+ (API 31+) gates Bluetooth connect behind a runtime-requested
 * dangerous permission, declared in app.json but not granted until asked.
 * A no-op that resolves true on older Android and on iOS (where this whole
 * module is unused).
 */
async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (typeof PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT === "undefined") return true; // pre-12
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
    title: "Bluetooth-Zugriff",
    message: "DishData braucht Bluetooth, um den Kassenbon zu drucken.",
    buttonPositive: "OK",
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/** Lazily required — the native module doesn't exist until an EAS build with the plugin baked in. */
function loadModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("react-native-bluetooth-classic").default;
}

/** Devices already paired to this tablet (via Android's Bluetooth settings, or Wolt/Uber's own pairing flow). */
export async function listPairedPrinters(): Promise<BluetoothPrinterDevice[]> {
  if (!bluetoothPrintingSupported()) return [];
  if (!(await ensurePermission())) throw new Error("Bluetooth-Berechtigung nicht erteilt.");
  const RNBluetoothClassic = loadModule();
  const devices = await RNBluetoothClassic.getBondedDevices();
  return (devices as { name: string; address: string }[]).map((d) => ({ name: d.name, address: d.address }));
}

export async function getSavedPrinter(): Promise<BluetoothPrinterDevice | null> {
  const raw = await AsyncStorage.getItem(DEVICE_KEY);
  return raw ? (JSON.parse(raw) as BluetoothPrinterDevice) : null;
}

export async function savePrinter(device: BluetoothPrinterDevice | null): Promise<void> {
  if (device) await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  else await AsyncStorage.removeItem(DEVICE_KEY);
}

export interface BtPrintResult {
  ok: boolean;
  receiptNumber?: string;
  message: string;
}

/**
 * Print a Beleg for a PAID order over the saved Bluetooth device.
 *
 * The receipt bytes are rendered server-side — same buildEscPosReceipt as the
 * network path, just base64-encoded raw ESC/POS instead of ePOS-Print XML —
 * so the printed layout and VAT math can never drift between the two
 * transports. This function's only job is getting those exact bytes onto the
 * Bluetooth socket unmodified.
 */
export async function printReceiptViaBluetooth(orderId: string): Promise<BtPrintResult> {
  if (!bluetoothPrintingSupported()) {
    return { ok: false, message: "Bluetooth-Druck ist nur auf Android verfügbar." };
  }
  if (!isSupabaseConfigured) {
    return { ok: false, message: "Drucken benötigt eine Verbindung zum Backend." };
  }

  const device = await getSavedPrinter();
  if (!device) {
    return { ok: false, message: "Kein Bluetooth-Drucker ausgewählt (Einstellungen → Drucker)." };
  }

  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: "Nicht angemeldet." };

  // 1. Render — same server call as the network path, just format:"raw".
  let bytesBase64: string;
  let receiptNumber: string | undefined;
  try {
    const res = await fetch(`${API_URL}/api/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ order_id: orderId, format: "raw" }),
    });
    const bodyJson = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: bodyJson.error || `Beleg-Fehler (${res.status})` };
    if (!bodyJson.rawBase64) return { ok: false, message: "Kein Druckauftrag erhalten." };
    bytesBase64 = bodyJson.rawBase64 as string;
    receiptNumber = bodyJson.receiptNumber as string;
  } catch {
    return { ok: false, message: "Beleg konnte nicht erstellt werden." };
  }

  // 2. Send — connect if needed, write the exact bytes, disconnect.
  // Buffer.from(base64) round-trips to the identical bytes buildEscPosReceipt
  // produced; write() base64-encodes it again only for the JS<->native bridge
  // (RN bridges are string-based), which the native side decodes back to raw
  // bytes before the actual socket write — so nothing here re-interprets the
  // bytes as text, which would corrupt the CP858 characters and the QR block.
  try {
    if (!(await ensurePermission())) return { ok: false, receiptNumber, message: "Bluetooth-Berechtigung nicht erteilt." };
    const RNBluetoothClassic = loadModule();

    const alreadyConnected: boolean = await RNBluetoothClassic.isDeviceConnected(device.address);
    const conn = alreadyConnected
      ? await RNBluetoothClassic.getConnectedDevice(device.address)
      : await RNBluetoothClassic.connectToDevice(device.address, { delimiter: "" });

    const buffer = Buffer.from(bytesBase64, "base64");
    await conn.write(buffer);

    return { ok: true, receiptNumber, message: `Bon gedruckt${receiptNumber ? ` · ${receiptNumber}` : ""}` };
  } catch (e) {
    return {
      ok: false,
      receiptNumber,
      message: `Drucker "${device.name}" nicht erreichbar. Ist er eingeschaltet und in Reichweite?`,
    };
  }
}
