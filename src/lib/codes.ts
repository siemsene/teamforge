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
