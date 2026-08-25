// Key material for the optional team-management phase.
//
// Member key: derived from a student's login code with PBKDF2 (the code has
// ~50 bits of entropy, so it is stretched like a passphrase). The derivation is
// domain-separated from the SHA-256(code) used as the student doc id — the
// stored hash cannot yield the key. The instructor (who holds the code→name
// CSV) derives the same key to write each student's encrypted roster blob and
// published results; the student re-derives it from their code at login.
//
// Team key: derived from a random high-entropy team token with HKDF (no
// stretching needed). The token is distributed only inside member-key-encrypted
// roster blobs; its SHA-256 hash is the team doc id (get-not-list capability,
// mirroring login codes).

import { aesDecrypt, aesEncrypt } from "./crypto";
import { normalizeCode } from "./codes";
import type { AesEnvelope } from "../types";

const subtle = globalThis.crypto.subtle;

const MEMBER_KEY_ITERATIONS = 600_000;
const MEMBER_KEY_SALT_PREFIX = "teamforge-member-key-v1|";
const TEAM_KEY_SALT_PREFIX = "teamforge-team-key-v1|";

// Crockford base32, matching login codes (no I, L, O, U).
const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOKEN_LENGTH = 26; // 26 chars * 5 bits = 130 bits of entropy

// ---------- member key (from a login code) ----------

/** Raw 256-bit member key. Exportable so the instructor can keep it in the
 * (encrypted) team directory and publish results without the codes CSV. */
export async function deriveMemberKeyRaw(sid: string, code: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey("raw", enc.encode(normalizeCode(code)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(MEMBER_KEY_SALT_PREFIX + sid) as BufferSource,
      iterations: MEMBER_KEY_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function importMemberKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function deriveMemberKey(sid: string, code: string): Promise<CryptoKey> {
  return importMemberKey(await deriveMemberKeyRaw(sid, code));
}

// ---------- team token & team key ----------

export function generateTeamToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) token += TOKEN_ALPHABET[bytes[i] % 32];
  return token;
}

/** Team doc id. Same construction as hashCode but without code normalization. */
export async function hashTeamToken(token: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveTeamKey(sid: string, teamToken: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey("raw", enc.encode(teamToken), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(TEAM_KEY_SALT_PREFIX + sid) as BufferSource,
      info: enc.encode("contract") as BufferSource,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------- symmetric envelopes ----------

export async function sealEnvelope(key: CryptoKey, plaintext: string): Promise<AesEnvelope> {
  return aesEncrypt(key, new TextEncoder().encode(plaintext));
}

/** Throws on a wrong key or tampered ciphertext (AES-GCM authentication). */
export async function openEnvelope(key: CryptoKey, env: AesEnvelope): Promise<string> {
  return new TextDecoder().decode(await aesDecrypt(key, env.iv, env.ciphertext));
}
