// Student login codes: high-entropy capability tokens. Only the SHA-256 hash
// is stored in Firestore (as the student document id); the plaintext codes are
// shown to the instructor exactly once as a CSV download.

// Crockford base32 (no I, L, O, U) — unambiguous when read aloud or typed.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10; // 10 chars * 5 bits = 50 bits of entropy

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % 32];
  }
  // XXXXX-XXXXX for readability
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function generateCodes(n: number): string[] {
  const seen = new Set<string>();
  while (seen.size < n) seen.add(generateCode());
  return [...seen];
}

// Public "share code": a short identifier a student can give to classmates so
// they can list them as preferred teammates. It is NOT a login secret and
// reveals nothing about the login code, so sharing it cannot enable
// impersonation. 4 chars from the 32-char alphabet (~1M space) — generated
// unique per session, so matching is unambiguous.
const SHARE_CODE_LENGTH = 4;

export function generateShareCode(): string {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += ALPHABET[bytes[i] % 32];
  return code;
}

/**
 * Fresh share codes, unique among themselves and against every code already
 * issued in this session.
 *
 * `taken` matters once students can be added later. A duplicate share code is
 * not cosmetic: AllocationTab builds a `normalizeCode(shareCode) -> hash` map,
 * where a second entry for the same code silently overwrites the first — so one
 * student's teammate preference would be recorded against a classmate who never
 * appeared in their answer. Comparison is under `normalizeCode` for the same
 * reason the lookup is.
 *
 * Throws rather than spinning if the space is exhausted; 4 chars over a
 * 32-symbol alphabet is ~1M, so this cannot happen below the 1000-student cap,
 * but a silent infinite loop is not an acceptable failure mode either way.
 */
export function generateShareCodes(n: number, taken: Iterable<string> = []): string[] {
  const seen = new Set<string>();
  for (const code of taken) seen.add(normalizeCode(code));
  const fresh: string[] = [];
  let attempts = 0;
  while (fresh.length < n) {
    if (attempts++ > 1000 * (n + 1)) {
      throw new Error("Could not generate enough distinct share codes for this session.");
    }
    const code = generateShareCode();
    const key = normalizeCode(code);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(code);
  }
  return fresh;
}

/** Tolerant of case, spaces, dashes, and common transcription mistakes (O->0, I/L->1). */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeCode(code));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
