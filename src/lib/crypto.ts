// Client-side cryptography. All student data is encrypted in the browser with
// the session public key (ECIES: ephemeral ECDH P-256 + AES-256-GCM) and can
// only be decrypted with the session private key, which exists in plaintext
// solely in the instructor's browser memory after they enter their passphrase
// or recovery key. The database stores ciphertext only.

import type { EciesPayload, WrappedKeys } from "../types";

const subtle = globalThis.crypto.subtle;

const ECDH_PARAMS: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const PBKDF2_ITERATIONS = 600_000;

// ---------- encoding helpers ----------

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

// ---------- key derivation ----------

async function deriveAesKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importRecoveryKey(recoveryKeyB64: string): Promise<CryptoKey> {
  return subtle.importKey("raw", fromBase64(recoveryKeyB64) as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { iv: toBase64(iv), ciphertext: toBase64(ct) };
}

async function aesDecrypt(key: CryptoKey, ivB64: string, ciphertextB64: string): Promise<Uint8Array> {
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) as BufferSource },
    key,
    fromBase64(ciphertextB64) as BufferSource,
  );
  return new Uint8Array(pt);
}

// ---------- session key lifecycle ----------

export interface GeneratedSessionKeys {
  wrappedKeys: WrappedKeys;
  /** Show once and offer as a download; never stored server-side. */
  recoveryKeyB64: string;
}

export async function generateSessionKeys(passphrase: string): Promise<GeneratedSessionKeys> {
  const keyPair = await subtle.generateKey(ECDH_PARAMS, true, ["deriveKey"]);
  const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwkBytes = new TextEncoder().encode(
    JSON.stringify(await subtle.exportKey("jwk", keyPair.privateKey)),
  );

  const salt = randomBytes(16);
  const passKey = await deriveAesKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
  const passWrapped = await aesEncrypt(passKey, privateJwkBytes);

  const recoveryRaw = randomBytes(32);
  const recoveryKeyB64 = toBase64(recoveryRaw);
  const recoveryKey = await importRecoveryKey(recoveryKeyB64);
  const recoveryWrapped = await aesEncrypt(recoveryKey, privateJwkBytes);

  return {
    wrappedKeys: {
      publicKeyJwk,
      passphrase: {
        salt: toBase64(salt),
        iterations: PBKDF2_ITERATIONS,
        iv: passWrapped.iv,
        ciphertext: passWrapped.ciphertext,
      },
      recovery: recoveryWrapped,
    },
    recoveryKeyB64,
  };
}

async function importPrivateKey(jwkBytes: Uint8Array): Promise<CryptoKey> {
  const jwk = JSON.parse(new TextDecoder().decode(jwkBytes)) as JsonWebKey;
  return subtle.importKey("jwk", jwk, ECDH_PARAMS, false, ["deriveKey"]);
}

/** Throws on a wrong passphrase (AES-GCM authentication failure). */
export async function unlockWithPassphrase(wrapped: WrappedKeys, passphrase: string): Promise<CryptoKey> {
  const key = await deriveAesKeyFromPassphrase(
    passphrase,
    fromBase64(wrapped.passphrase.salt),
    wrapped.passphrase.iterations,
  );
  const jwkBytes = await aesDecrypt(key, wrapped.passphrase.iv, wrapped.passphrase.ciphertext);
  return importPrivateKey(jwkBytes);
}

export async function unlockWithRecoveryKey(wrapped: WrappedKeys, recoveryKeyB64: string): Promise<CryptoKey> {
  const key = await importRecoveryKey(recoveryKeyB64.trim());
  const jwkBytes = await aesDecrypt(key, wrapped.recovery.iv, wrapped.recovery.ciphertext);
  return importPrivateKey(jwkBytes);
}

// ---------- ECIES encrypt/decrypt ----------

async function deriveSharedAesKey(privateKey: CryptoKey, publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const publicKey = await subtle.importKey("jwk", publicKeyJwk, ECDH_PARAMS, false, []);
  return subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt for the session: anyone with the public key can write, only the private key holder can read. */
export async function eciesEncrypt(sessionPublicKeyJwk: JsonWebKey, plaintext: string): Promise<EciesPayload> {
  const ephemeral = await subtle.generateKey(ECDH_PARAMS, true, ["deriveKey"]);
  const aesKey = await deriveSharedAesKey(ephemeral.privateKey, sessionPublicKeyJwk);
  const { iv, ciphertext } = await aesEncrypt(aesKey, new TextEncoder().encode(plaintext));
  return {
    ephemeralPublicKeyJwk: await subtle.exportKey("jwk", ephemeral.publicKey),
    iv,
    ciphertext,
  };
}

export async function eciesDecrypt(sessionPrivateKey: CryptoKey, payload: EciesPayload): Promise<string> {
  const aesKey = await deriveSharedAesKey(sessionPrivateKey, payload.ephemeralPublicKeyJwk);
  const pt = await aesDecrypt(aesKey, payload.iv, payload.ciphertext);
  return new TextDecoder().decode(pt);
}
