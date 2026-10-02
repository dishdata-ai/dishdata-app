// Location for the clock-in check — the phone twin of the web app's src/lib/geo.ts. Best-effort: it reads the
// position once, when someone taps Clock in, and only if the restaurant has set up a geofence.

import * as Location from "expo-location";
import type { Org } from "@/lib/types";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface Geofence {
  lat: number;
  lng: number;
  radiusM: number;
}

/** Meters between two lat/lng points (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export class GeoError extends Error {
  constructor(
    public reason: "denied" | "unavailable" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

/** One-shot position read; failures come back as a GeoError with a message that can be shown as-is. */
export async function getCurrentPosition(timeoutMs = 12000): Promise<GeoPoint> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    throw new GeoError("denied", "Location access was denied. Allow it in your phone's settings to clock in here.");
  }
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new GeoError("timeout", "Couldn't get a location fix in time — try again.")), timeoutMs),
      ),
    ]);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 };
  } catch (e) {
    if (e instanceof GeoError) throw e;
    throw new GeoError("unavailable", "Couldn't determine your location.");
  }
}

/** Reads org.clockin_* into a Geofence, or null when the restaurant hasn't set one up. */
export function geofenceOf(org: Pick<Org, "clockin_lat" | "clockin_lng" | "clockin_radius_m">): Geofence | null {
  if (org.clockin_lat == null || org.clockin_lng == null || org.clockin_radius_m == null) return null;
  return { lat: org.clockin_lat, lng: org.clockin_lng, radiusM: org.clockin_radius_m };
}
