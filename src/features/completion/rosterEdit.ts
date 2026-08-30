// Pure helpers behind adding and removing students on a live session.
//
// No Firestore, no crypto, no React — so the index arithmetic (the part that is
// unrecoverable when wrong) and the wording of the removal warnings are directly
// unit-testable.

import type { StudentDoc } from "../../types";

/**
 * The next code index to issue.
 *
 * Deliberately *not* `max(...students) + 1`. Remove the highest-numbered student
 * and that maximum falls, so the next student added would inherit an index that
 * has already been handed out — and a code index is what names a student inside
 * every encrypted payload the platform holds (nickname map keys,
 * RosterInfo.teammates, a ballot's points map, a published result). None of
 * those can be rewritten to say otherwise, so the new student would silently
 * acquire the old one's history.
 *
 * `maxCodeIndex` is therefore a high-water mark that never falls. Sessions
 * created before it existed have none, so fall back to whichever of the count
 * and the live roster is higher; both are correct for a session nobody has
 * removed anyone from, which is exactly the population that lacks the field.
 */
export function nextCodeIndex(
  students: { codeIndex: number }[],
  session: { maxCodeIndex?: number; numStudents?: number },
): number {
  const liveMax = students.reduce((n, s) => Math.max(n, s.codeIndex), 0);
  return Math.max(session.maxCodeIndex ?? 0, session.numStudents ?? 0, liveMax) + 1;
}

/** Largest index a caller can prove it saw, for the claim check in addStudents. */
export function observedMaxCodeIndex(
  students: { codeIndex: number }[],
  session: { maxCodeIndex?: number; numStudents?: number },
): number {
  return nextCodeIndex(students, session) - 1;
}

/**
 * Rows for the CSV handed over when students are added.
 *
 * The header must stay byte-identical to the one session creation writes
 * (DashboardPage). The instructor is told to append these rows to that file, and
 * the roster importer is later handed the combined result — a second header
 * spelling would break the append and the re-import at once.
 */
export const CODES_CSV_HEADER = [
  "studentIndex",
  "loginCode",
  "shareCode",
  "surveyLink",
  "yourStudentName",
  "yourStudentEmail",
] as const;

export function addedCodesCsvRows(
  entries: { codeIndex: number; code: string; shareCode: string }[],
  surveyLink: string,
): (string | number)[][] {
  return [
    [...CODES_CSV_HEADER],
    ...entries.map((e) => [e.codeIndex, e.code, e.shareCode, surveyLink, "", ""]),
  ];
}

/** e.g. "mgmt-4500-abc123-student-codes-31-35.csv" — an index range, so it is
 * obviously an addition and cannot be mistaken for the master file. */
export function addedCodesSuffix(first: number, last: number): string {
  return first === last ? `student-codes-${first}.csv` : `student-codes-${first}-${last}.csv`;
}

// ---------- removal ----------

export type RemovalConsequence =
  | "hasResponse"
  | "inSavedAllocation"
  | "provisionedTeam"
  | "submittedBallot"
  | "resultsPublished"
  | "teamKeyRetained";

type RemovableStudent = Pick<
  StudentDoc,
  | "submittedAt"
  | "roster"
  | "peerEvalFormative"
  | "peerEvalSummative"
  | "resultFormative"
  | "resultSummative"
>;

/**
 * What removing this selection actually costs, so the confirmation can say it
 * rather than warning in general terms.
 *
 * Everything here is readable without the passphrase: `roster` being present is
 * key-free proof that a student is on a provisioned team, and whether an
 * allocation exists comes from the plaintext half of its document. What we
 * cannot tell while locked is whether *this* student is in that allocation, so
 * the caller's copy says "the saved allocation" rather than naming them.
 */
export function removalConsequences(
  selected: RemovableStudent[],
  ctx: { allocationSaved: boolean },
): RemovalConsequence[] {
  const out = new Set<RemovalConsequence>();
  for (const s of selected) {
    if (s.submittedAt) out.add("hasResponse");
    if (s.roster) {
      out.add("provisionedTeam");
      // Not conditional on anything else: the team key travels inside the roster
      // blob, and once a student has opened it, deleting their document cannot
      // take it back. See the note in the dialog.
      out.add("teamKeyRetained");
    }
    if (s.peerEvalFormative || s.peerEvalSummative) out.add("submittedBallot");
    if (s.resultFormative || s.resultSummative) out.add("resultsPublished");
  }
  if (ctx.allocationSaved) out.add("inSavedAllocation");

  // Stable order, worst-consequence-first, so the dialog reads the same way every
  // time rather than following selection order.
  const ORDER: RemovalConsequence[] = [
    "hasResponse",
    "inSavedAllocation",
    "provisionedTeam",
    "submittedBallot",
    "resultsPublished",
    "teamKeyRetained",
  ];
  return ORDER.filter((c) => out.has(c));
}
