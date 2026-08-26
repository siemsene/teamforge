// Student-chosen display names for the team-management phase.
//
// The instructor never uploads names — only which code index sits on which
// team. Each student picks their own nickname, which is sealed under the team
// key so teammates (and the instructor, who holds the team token in the
// encrypted directory) can read it. A student who hasn't chosen one yet simply
// shows as their code index.

import { deriveTeamKey, hashTeamToken, openEnvelope, sealEnvelope } from "./memberKey";
import { NICKNAME_MAX_LENGTH, type AesEnvelope, type Nicknames } from "../types";

/** C0 controls and DEL — stripped so a nickname cannot smuggle newlines or
 * terminal escapes into a table, a CSV export, or the contract PDF. */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f;
}

/** Trim, collapse whitespace, strip control characters, and cap the length. */
export function sanitizeNickname(raw: string): string {
  const cleaned = Array.from(raw, (ch) => (isControl(ch.codePointAt(0) ?? 0) ? " " : ch)).join("");
  return cleaned.replace(/\s+/g, " ").trim().slice(0, NICKNAME_MAX_LENGTH);
}

/** Human-readable problems with a proposed nickname; empty means it is fine.
 * `taken` holds the sanitized nicknames of the student's teammates — duplicates
 * within a team would make peer-evaluation point allocation ambiguous. */
export function validateNickname(raw: string, taken: string[]): string[] {
  const value = sanitizeNickname(raw);
  const problems: string[] = [];
  if (!value) problems.push("Please enter a display name.");
  if (raw.trim().length > NICKNAME_MAX_LENGTH)
    problems.push(`Please keep it to ${NICKNAME_MAX_LENGTH} characters or fewer.`);
  if (value && taken.some((t) => t.toLowerCase() === value.toLowerCase()))
    problems.push("A teammate is already using that name — please pick a different one.");
  return problems;
}

/** What to show for a code index: their chosen name, or a neutral placeholder. */
export function displayName(codeIndex: number, nicknames: Nicknames): string {
  return nicknames[String(codeIndex)] || `#${codeIndex}`;
}

/** True when this student still needs to choose a display name. */
export function hasNickname(codeIndex: number, nicknames: Nicknames): boolean {
  return Boolean(nicknames[String(codeIndex)]);
}

/** Decrypt every nickname on a team doc. Entries that fail to open (tampered,
 * or written under a stale key) are skipped rather than breaking the page. */
export async function openNicknames(
  teamKey: CryptoKey,
  sealed: Record<string, AesEnvelope> | undefined,
): Promise<Nicknames> {
  const out: Nicknames = {};
  for (const [codeIndex, envelope] of Object.entries(sealed ?? {})) {
    try {
      out[codeIndex] = sanitizeNickname(await openEnvelope(teamKey, envelope));
    } catch {
      // Leave it unset; callers fall back to the code index.
    }
  }
  return out;
}

export async function sealNickname(teamKey: CryptoKey, nickname: string): Promise<AesEnvelope> {
  return sealEnvelope(teamKey, sanitizeNickname(nickname));
}

/**
 * Instructor-side: decrypt every team's nicknames using the team tokens held in
 * the (already decrypted) directory. Code indexes are unique across a session,
 * so the result is one flat lookup. Teams whose doc is missing are skipped.
 */
export async function openDirectoryNicknames(
  sid: string,
  teams: { token: string }[],
  getTeam: (tokenHash: string) => Promise<{ nicknames?: Record<string, AesEnvelope> } | null>,
): Promise<Nicknames> {
  const out: Nicknames = {};
  for (const team of teams) {
    const teamDoc = await getTeam(await hashTeamToken(team.token));
    if (!teamDoc) continue;
    const teamKey = await deriveTeamKey(sid, team.token);
    Object.assign(out, await openNicknames(teamKey, teamDoc.nicknames));
  }
  return out;
}
