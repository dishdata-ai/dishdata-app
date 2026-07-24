/**
 * Adyen Terminal API — Nexo message building + NexoCrypto encryption.
 *
 * Used for LOCAL integration with a Vivid payment terminal (Vivid's terminals
 * run on Adyen). The POS posts an encrypted SaleToPOIRequest straight to the
 * terminal on the venue LAN:
 *
 *     POST https://<terminal-ip>:8443/nexo
 *
 * Because it is a local (not cloud) integration the request must originate from
 * a device on the same network as the terminal — i.e. this phone — so the
 * crypto has to run in React Native. `crypto-js` is used rather than node's
 * `crypto` (unavailable in RN) as it is pure JS and needs no native module.
 *
 * Spec (docs.adyen.com → Point of sale → local → "Protect with your own code"):
 *   • Key derivation: PBKDF2-HMAC-SHA1, salt "AdyenNexoV1Salt", 4000 rounds,
 *     80-byte output → [0..32) hmacKey, [32..64) cipherKey, [64..80) iv
 *   • Encryption: AES-256-CBC, actualIV[i] = derivedIv[i] ^ nonce[i]
 *   • Integrity: HMAC-SHA256 over the *plaintext*, using hmacKey
 *   • Wire format: SaleToPOISecuredMessage { MessageHeader, NexoBlob, SecurityTrailer }
 */

import CryptoJS from "crypto-js";

const SALT = "AdyenNexoV1Salt";
const ROUNDS = 4000;
const KEY_LENGTH_BYTES = 80;
const HMAC_KEY_LEN = 32;
const CIPHER_KEY_LEN = 32;
const IV_LEN = 16;

export interface SecurityKey {
  /** Shared-secret passphrase configured on the terminal. */
  passphrase: string;
  /** Name given to the key when it was set up ("Key identifier"). */
  keyIdentifier: string;
  /** Positive integer version of the key. */
  keyVersion: number;
}

export interface DerivedKey {
  hmacKey: CryptoJS.lib.WordArray;
  cipherKey: CryptoJS.lib.WordArray;
  iv: CryptoJS.lib.WordArray;
}

/** PBKDF2-HMAC-SHA1 → 80 bytes → hmacKey ‖ cipherKey ‖ iv. */
export function deriveKeyMaterial(passphrase: string): DerivedKey {
  const derived = CryptoJS.PBKDF2(passphrase, CryptoJS.enc.Utf8.parse(SALT), {
    keySize: KEY_LENGTH_BYTES / 4, // crypto-js counts 32-bit words
    iterations: ROUNDS,
    hasher: CryptoJS.algo.SHA1,
  });
  const bytes = wordArrayToBytes(derived);
  return {
    hmacKey: bytesToWordArray(bytes.slice(0, HMAC_KEY_LEN)),
    cipherKey: bytesToWordArray(bytes.slice(HMAC_KEY_LEN, HMAC_KEY_LEN + CIPHER_KEY_LEN)),
    iv: bytesToWordArray(
      bytes.slice(HMAC_KEY_LEN + CIPHER_KEY_LEN, HMAC_KEY_LEN + CIPHER_KEY_LEN + IV_LEN),
    ),
  };
}

/** actualIV = derivedIv XOR nonce (both 16 bytes), per Adyen's reference impl. */
function xorIv(iv: CryptoJS.lib.WordArray, nonce: CryptoJS.lib.WordArray): CryptoJS.lib.WordArray {
  const a = wordArrayToBytes(iv);
  const b = wordArrayToBytes(nonce);
  const out = new Uint8Array(IV_LEN);
  for (let i = 0; i < IV_LEN; i++) out[i] = a[i] ^ b[i];
  return bytesToWordArray(out);
}

export interface SecurityTrailer {
  AdyenCryptoVersion: number;
  KeyIdentifier: string;
  KeyVersion: number;
  Nonce: string;
  Hmac: string;
}

export interface SecuredPayload {
  nexoBlob: string;
  securityTrailer: SecurityTrailer;
}

/** Encrypt a SaleToPOIRequest/Response JSON string into a NexoBlob + trailer. */
export function encrypt(plaintext: string, key: SecurityKey): SecuredPayload {
  const dk = deriveKeyMaterial(key.passphrase);
  const nonce = CryptoJS.lib.WordArray.random(IV_LEN);

  const cipher = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plaintext), dk.cipherKey, {
    iv: xorIv(dk.iv, nonce),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  // HMAC is over the PLAINTEXT, not the ciphertext.
  const hmac = CryptoJS.HmacSHA256(CryptoJS.enc.Utf8.parse(plaintext), dk.hmacKey);

  return {
    nexoBlob: cipher.ciphertext.toString(CryptoJS.enc.Base64),
    securityTrailer: {
      AdyenCryptoVersion: 1,
      KeyIdentifier: key.keyIdentifier,
      KeyVersion: key.keyVersion,
      Nonce: nonce.toString(CryptoJS.enc.Base64),
      Hmac: hmac.toString(CryptoJS.enc.Base64),
    },
  };
}

/**
 * Decrypt a NexoBlob and verify its HMAC.
 * @throws if the HMAC does not match — treat as a tampered/invalid message.
 */
export function decrypt(payload: SecuredPayload, key: SecurityKey): string {
  const dk = deriveKeyMaterial(key.passphrase);
  const nonce = CryptoJS.enc.Base64.parse(payload.securityTrailer.Nonce);

  const decrypted = CryptoJS.AES.decrypt(
    // crypto-js wants a CipherParams object, not a raw base64 string.
    CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(payload.nexoBlob),
    }),
    dk.cipherKey,
    { iv: xorIv(dk.iv, nonce), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );

  const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
  const expected = CryptoJS.HmacSHA256(CryptoJS.enc.Utf8.parse(plaintext), dk.hmacKey).toString(
    CryptoJS.enc.Base64,
  );
  if (!timingSafeEqual(expected, payload.securityTrailer.Hmac)) {
    throw new Error("Nexo HMAC validation failed — message rejected");
  }
  return plaintext;
}

/** Constant-time string compare, mirroring the reference implementation. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------

export interface PaymentRequestInput {
  /** Stable id for this POS device (e.g. "kokoland-till-1"). */
  saleId: string;
  /** Terminal id, e.g. "V400m-123456789". */
  poiId: string;
  /** Unique per request, max 10 chars — echoed back in the response. */
  serviceId: string;
  /** Our order id / number, shown on the terminal receipt. */
  transactionId: string;
  /** Gross amount the guest pays. */
  amount: number;
  currency: string;
}

/** Build an unencrypted SaleToPOIRequest for a card payment. */
export function buildPaymentRequest(input: PaymentRequestInput): Record<string, unknown> {
  return {
    SaleToPOIRequest: {
      MessageHeader: {
        ProtocolVersion: "3.0",
        MessageClass: "Service",
        MessageCategory: "Payment",
        MessageType: "Request",
        ServiceID: input.serviceId,
        SaleID: input.saleId,
        POIID: input.poiId,
      },
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: {
            TransactionID: input.transactionId,
            TimeStamp: new Date().toISOString(),
          },
        },
        PaymentTransaction: {
          AmountsReq: {
            Currency: input.currency,
            RequestedAmount: input.amount,
          },
        },
      },
    },
  };
}

/** Wrap a built request in the encrypted SaleToPOISecuredMessage envelope. */
export function buildSecuredMessage(
  request: Record<string, unknown>,
  key: SecurityKey,
  header: { serviceId: string; saleId: string; poiId: string },
): Record<string, unknown> {
  const { nexoBlob, securityTrailer } = encrypt(JSON.stringify(request), key);
  return {
    SaleToPOISecuredMessage: {
      MessageHeader: {
        ProtocolVersion: "3.0",
        MessageClass: "Service",
        MessageCategory: "Payment",
        MessageType: "Request",
        ServiceID: header.serviceId,
        SaleID: header.saleId,
        POIID: header.poiId,
      },
      NexoBlob: nexoBlob,
      SecurityTrailer: securityTrailer,
    },
  };
}

/** ServiceID must be unique per request and at most 10 characters. */
export function newServiceId(): string {
  return Date.now().toString().slice(-10);
}

// ---------------------------------------------------------------------------
// WordArray <-> bytes helpers (crypto-js works in 32-bit words)
// ---------------------------------------------------------------------------

function wordArrayToBytes(wa: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wa;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function bytesToWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}
