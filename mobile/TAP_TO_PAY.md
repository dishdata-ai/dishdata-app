# Stripe Tap to Pay — staged integration

The backend is **done and live** (`/api/payments/terminal/*` on the web app) and the
fetch client `mobile/lib/api/terminal.ts` is in place. Everything below needs the
native Stripe Terminal SDK, which **cannot run in Expo Go** — you must move to a
custom **dev client / EAS build** first. Nothing here is wired into the app yet, so
Expo Go keeps working until you choose to do this.

## Prerequisites (external — do these first)

1. **Apple entitlement** `com.apple.developer.proximity-reader.payment.acceptance`
   — request via Apple Developer; accept Apple's Tap to Pay terms.
2. **Stripe Dashboard (test mode):** enable **Terminal** + **Tap to Pay**, and create a
   **Location** (Terminal → Locations). Connected accounts inherit Tap to Pay.
3. **Device:** iPhone XS or newer, iOS 16.7+. (Android needs a compatible NFC phone.)
4. **Env:** set `EXPO_PUBLIC_API_URL` to the web app origin (where `/api/payments/*` lives).

## 1. Install native deps

```bash
cd mobile
npx expo install @stripe/stripe-terminal-react-native
```

## 2. app.json — add the config plugin + entitlement

```jsonc
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-camera", { "cameraPermission": "..." }],
      ["@stripe/stripe-terminal-react-native", {
        "bluetoothBackgroundMode": false,
        "locationWhenInUsePermission": "Location is used to accept in-person payments.",
        "bluetoothPeripheralPermission": "Bluetooth is used to connect card readers.",
        "bluetoothAlwaysUsagePermission": "Bluetooth is used to connect card readers."
      }]
    ],
    "ios": {
      "bundleIdentifier": "com.dishdata.mobile",
      "entitlements": {
        "com.apple.developer.proximity-reader.payment.acceptance": true
      }
    }
  }
}
```

## 3. eas.json — a dev-client build profile

```jsonc
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false }
    }
  }
}
```

Build & install on a real device (Tap to Pay does not work in the simulator):

```bash
eas build --profile development --platform ios
```

## 4. Terminal provider — `mobile/lib/terminal.tsx`

```tsx
import { StripeTerminalProvider } from "@stripe/stripe-terminal-react-native";
import { fetchConnectionToken } from "@/lib/api/terminal";
import type { ReactNode } from "react";

export function TerminalProvider({ children }: { children: ReactNode }) {
  return (
    <StripeTerminalProvider
      logLevel="verbose"
      tokenProvider={async () => (await fetchConnectionToken()).secret}
    >
      {children}
    </StripeTerminalProvider>
  );
}
```

Wrap the app once (e.g. in `app/_layout.tsx`, inside your auth/org providers):

```tsx
<TerminalProvider>{children}</TerminalProvider>
```

## 5. Tap to Pay button — `mobile/components/TapToPayButton.tsx`

```tsx
import { useState } from "react";
import { Alert } from "react-native";
import { useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { createTerminalIntent } from "@/lib/api/terminal";
import { Button } from "@/components/ui";

const LOCATION_ID = "tml_xxx"; // from Stripe Dashboard → Terminal → Locations

export function TapToPayButton({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const {
    discoverReaders, connectReader, collectPaymentMethod, confirmPaymentIntent,
    retrievePaymentIntent, connectedReader,
  } = useStripeTerminal();
  const [busy, setBusy] = useState(false);

  const charge = async () => {
    setBusy(true);
    try {
      // 1. Ensure a Tap-to-Pay reader is connected (the phone itself).
      if (!connectedReader) {
        const { readers, error } = await discoverReaders({ discoveryMethod: "tapToPay" });
        if (error) throw new Error(error.message);
        const { error: cErr } = await connectReader(
          { reader: readers[0], locationId: LOCATION_ID },
          "tapToPay",
        );
        if (cErr) throw new Error(cErr.message);
      }
      // 2. Create the card-present intent on the backend, then collect + confirm.
      const { clientSecret } = await createTerminalIntent(orderId);
      const { paymentIntent, error: rErr } = await retrievePaymentIntent(clientSecret);
      if (rErr) throw new Error(rErr.message);
      const { error: colErr } = await collectPaymentMethod({ paymentIntent });
      if (colErr) throw new Error(colErr.message);
      const { error: confErr } = await confirmPaymentIntent({ paymentIntent });
      if (confErr) throw new Error(confErr.message);
      // 3. Webhook (payment_intent.succeeded) marks the order paid server-side.
      onPaid();
    } catch (e) {
      Alert.alert("Payment failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  return <Button title="Tap to Pay" loading={busy} onPress={charge} />;
}
```

> The exact `useStripeTerminal` method names / discovery enum (`tapToPay` vs
> `localMobile`) can differ by SDK version — check the installed package's types.

## 6. Wire into the POS

In `mobile/app/(tabs)/pos.tsx`, after `checkoutOrder(...)` returns `{ order_id }`,
create the order as an **open tab** (empty `payments: []`) and render
`<TapToPayButton orderId={order_id} onPaid={...} />`. On success the webhook flips
the order to `paid`; refetch orders to reflect it.

## How it flows

```
POS: create open order ──▶ TapToPayButton
   └─ connection token ◀── /api/payments/terminal/connection-token (connected acct)
   └─ card-present intent ◀ /api/payments/terminal/intent  (amount from DB, + app fee)
   └─ tap card on phone ──▶ confirmPaymentIntent
Stripe ──▶ webhook payment_intent.succeeded ──▶ order marked paid
```

## Test

- Stripe test mode supports a **simulated** Tap to Pay flow; on a real enrolled
  device, use Stripe's test cards. Watch `stripe listen` for
  `payment_intent.succeeded → 200` and confirm the order flips to `paid`.
