# Vivid payment terminal — local Adyen Terminal API integration

Lets the POS push the amount straight to the card terminal instead of staff
keying it in. Vivid's terminals run on Adyen, so this is an **Adyen Terminal API
local integration**: the phone posts an encrypted `SaleToPOIRequest` to the
terminal over the venue LAN.

    POST https://<terminal-ip>:8443/nexo

Vivid supports self-built tills for this but **does not certify or support the
integration** — correctness is on us.

## Status

| Piece | State |
|---|---|
| NexoCrypto (key derivation, AES-256-CBC, HMAC) — `lib/payments/nexo.ts` | ✅ Done, cross-validated byte-for-byte against Node's native crypto |
| Nexo message building + secured envelope | ✅ Done |
| Terminal HTTP client — `lib/payments/terminal.ts` | ✅ Done (untested against real hardware) |
| Android trust for Adyen's root CA | ❌ **Blocker** — see below |
| Terminal config storage + settings UI | ❌ Not built |
| Wiring into the POS pay flow | ❌ Not built |
| Tested against a real terminal | ❌ Not done |

## What we still need from Vivid / Adyen

1. **Terminal POI ID** — e.g. `V400m-123456789` (shown on the terminal).
2. **Shared key** set up on the terminal, giving us three values:
   - passphrase (12+ chars, upper + lower + number + special)
   - key identifier (a name)
   - key version (positive integer)
3. **Adyen root certificate** — required to trust the terminal's TLS cert.
4. **A fixed terminal IP** — DHCP reservation on the venue router, or static.

## The TLS blocker

The terminal serves HTTPS on `:8443` with a certificate signed by Adyen's root
CA, which Android does **not** trust by default. `fetch()` will fail with an SSL
error until the app is built trusting that CA. This needs:

- the Adyen root CA `.pem` added to the Android build, and
- a `network_security_config.xml` referencing it, wired into the manifest.

In this Expo project that means a small **custom config plugin** (Expo's managed
manifest can't express it otherwise), then a new EAS build. It cannot be done in
Expo Go — it requires a real build, which we already use.

`terminal.ts` detects this failure mode and reports it explicitly rather than
surfacing a bare "Network request failed".

## Operational notes

- **One terminal handles one transaction at a time.** With two sales phones
  sharing a single terminal, staff will collide mid-sale. Either use one
  terminal per phone, or designate a single paying device.
- **`saleId` must be unique per phone** (e.g. `kokoland-till-1`, `-till-2`).
- **`serviceId` must be unique per request**, max 10 characters.
- Log `ServiceID`, `SaleID` and `POIID` — Vivid/Adyen support ask for these.
- A local-network dependency on a fixed IP is fragile on event Wi-Fi or a phone
  hotspot. Don't debut this at a live event; keep manual entry as the fallback.

## Verifying the crypto

The crypto was validated by deriving keys with `crypto-js` and with Node's
native `crypto.pbkdf2Sync(passphrase, "AdyenNexoV1Salt", 4000, 80, "sha1")` and
asserting the 80 bytes are identical, then confirming Node's
`createDecipheriv("aes-256-cbc", cipherKey, derivedIv XOR nonce)` decrypts our
ciphertext and that `createHmac("sha256", hmacKey)` over the plaintext matches
our trailer. Re-run that cross-check if `crypto-js` is ever swapped out.
