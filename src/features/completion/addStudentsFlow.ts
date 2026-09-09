// Minting login codes for students added to a live session, shared by the
// Roster tab (add to the session) and the Teams tab (add straight onto a team).
//
// The codes exist only in the browser between generation and the download —
// Firestore keeps nothing but their hashes — so the file is built before
// anything is written, and a write that fails halfway must not take it down.

import { addStudents, CodeIndexRaceError } from "../../lib/db";
import { generateCodes, generateShareCodes, hashCode } from "../../lib/codes";
import { sessionFilename, surveyUrl, toCsv } from "../../lib/util";
import type { SessionDoc, StudentDoc } from "../../types";
import { addedCodesCsvRows, addedCodesSuffix, nextCodeIndex, observedMaxCodeIndex } from "./rosterEdit";

export interface AddedCodes {
  firstIndex: number;
  lastIndex: number;
  filename: string;
  csv: string;
  /** Set when the write failed after the codes had been generated. */
  incomplete?: string;
}

export interface MintedStudents {
  roster: { hash: string; shareCode: string; codeIndex: number }[];
  /** Plaintext login codes, parallel to `roster`. */
  codes: string[];
  bundle: AddedCodes;
  observedMax: number;
}

export const MAX_STUDENTS = 1000;

/** Everything needed to add `count` students, computed before any write. */
export async function mintStudents(
  sid: string,
  session: Pick<SessionDoc, "title" | "maxCodeIndex" | "numStudents">,
  students: Pick<StudentDoc, "codeIndex" | "shareCode">[],
  count: number,
): Promise<MintedStudents> {
  if (count < 1) throw new Error("Add at least one student.");
  if (students.length + count > MAX_STUDENTS) {
    throw new Error(`A session holds at most ${MAX_STUDENTS} students; this one has ${students.length}.`);
  }
  const first = nextCodeIndex(students, session);
  const codes = generateCodes(count);
  const hashes = await Promise.all(codes.map(hashCode));
  const shareCodes = generateShareCodes(
    count,
    students.map((s) => s.shareCode ?? "").filter(Boolean),
  );
  const roster = hashes.map((hash, i) => ({ hash, shareCode: shareCodes[i], codeIndex: first + i }));
  const last = first + count - 1;
  const csv = toCsv(
    addedCodesCsvRows(
      roster.map((r, i) => ({ codeIndex: r.codeIndex, code: codes[i], shareCode: r.shareCode })),
      surveyUrl(sid),
    ),
  );
  return {
    roster,
    codes,
    bundle: {
      firstIndex: first,
      lastIndex: last,
      filename: sessionFilename(session.title, sid, addedCodesSuffix(first, last)),
      csv,
    },
    observedMax: observedMaxCodeIndex(students, session),
  };
}

/**
 * Writes the minted students. A refused index claim means nothing was written
 * and the codes reached nobody, which the caller should say rather than hand
 * over a file of codes for students who do not exist. Any other failure is
 * thrown: the docs may be partly written, and the codes file must still be
 * offered.
 */
export async function commitAddedStudents(
  sid: string,
  minted: MintedStudents,
): Promise<{ ok: true } | { ok: false; refused: string }> {
  try {
    await addStudents(sid, minted.roster, minted.observedMax);
    return { ok: true };
  } catch (err) {
    if (err instanceof CodeIndexRaceError) return { ok: false, refused: err.message };
    throw err;
  }
}
