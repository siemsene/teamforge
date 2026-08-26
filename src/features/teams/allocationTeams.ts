// Joins the roster CSV against the allocation the optimizer already produced,
// so the instructor never re-enters team assignments the app is holding.
//
// The upload itself cannot go away. Login codes are shown once at session
// creation and never stored — Firestore keeps only SHA-256(code) — and team
// management needs the plaintext code to derive each student's member key. So
// the instructor has to hand the codes back. What they should not have to hand
// back is *which team each student is on*: that lives in
// sessions/{sid}/results/allocation, keyed by the very same code hash.
//
// Everything here is pure (bar one WebCrypto digest), so the join is testable
// without Firestore.

import { hashCode } from "../../lib/codes";
import type { Allocation, Project, SessionDoc } from "../../types";
import type { RosterRow } from "./rosterCsv";

/**
 * Team id -> the label students and the instructor will see.
 *
 * Must mirror the ids AllocationTab hands the solver, since those are the keys
 * the saved allocation is written with: `team-K` for generic sessions, the
 * project id otherwise.
 */
export function teamLabels(
  session: Pick<SessionDoc, "genericProjects" | "numTeams">,
  projects: Pick<Project, "id" | "name">[],
): Map<string, string> {
  if (session.genericProjects) {
    return new Map(
      Array.from({ length: session.numTeams }, (_, k) => [`team-${k + 1}`, `Team ${k + 1}`]),
    );
  }
  return new Map(projects.map((p) => [p.id, p.name]));
}

export interface Membership {
  /** codeHash -> team label. */
  byHash: Map<string, string>;
  problems: string[];
}

/** Flattens a saved allocation into codeHash -> team label. */
export function membershipFromAllocation(
  allocation: Allocation,
  labels: Map<string, string>,
): Membership {
  const byHash = new Map<string, string>();
  const problems: string[] = [];

  for (const [teamId, hashes] of Object.entries(allocation.teams)) {
    // A project deleted since the allocation ran leaves its id unlabelled.
    // Fall back to the id rather than dropping those students silently.
    const label = labels.get(teamId);
    if (label == null) {
      problems.push(
        `The saved allocation has a team "${teamId}" that no longer matches a project — using the id as its label.`,
      );
    }
    for (const hash of hashes) byHash.set(hash, label ?? teamId);
  }
  return { byHash, problems };
}

export interface HashedRow {
  row: RosterRow;
  /** null when the row identifies nobody in this session. */
  codeHash: string | null;
}

/**
 * Resolves each row to a code hash — from the login code where present,
 * otherwise via the code index. SHA-256 is instant; the expensive PBKDF2 member
 * key derivation happens later, only for rows that survive review.
 */
export async function hashRows(
  rows: RosterRow[],
  students: { hash: string; codeIndex: number }[],
): Promise<HashedRow[]> {
  const hashByIndex = new Map(students.map((s) => [s.codeIndex, s.hash]));
  const out: HashedRow[] = [];
  for (const row of rows) {
    let codeHash: string | null = null;
    if (row.code) codeHash = await hashCode(row.code);
    else if (row.index != null) codeHash = hashByIndex.get(row.index) ?? null;
    out.push({ row, codeHash });
  }
  return out;
}

export interface JoinResult {
  rows: RosterRow[];
  /** Rows whose team came from the saved allocation. */
  fromAllocation: number;
  /** Rows that carried their own team label, overriding the allocation. */
  fromFile: number;
  problems: string[];
}

/**
 * Fills in the team for every row that did not carry one, from the allocation.
 *
 * A team written in the file always wins: an instructor who moved somebody
 * after allocating, or who never ran the optimizer at all, must still be able
 * to say so. Mismatches are reported in both directions, because a roster that
 * silently covers only half the class is the failure worth catching here.
 */
export function joinAllocationTeams(hashed: HashedRow[], membership: Membership): JoinResult {
  const rows: RosterRow[] = [];
  const problems = [...membership.problems];
  const matched = new Set<string>();
  let fromAllocation = 0;
  let fromFile = 0;

  for (const { row, codeHash } of hashed) {
    if (codeHash) matched.add(codeHash);

    if (row.team) {
      fromFile += 1;
      rows.push(row);
      continue;
    }
    const label = codeHash ? membership.byHash.get(codeHash) : undefined;
    if (label) {
      fromAllocation += 1;
      rows.push({ ...row, team: label });
      continue;
    }
    problems.push(
      `${describe(row)} is not in the saved allocation — add a "team" column for them, or re-run the allocation.`,
    );
    rows.push(row);
  }

  const missing = [...membership.byHash.keys()].filter((h) => !matched.has(h));
  if (missing.length > 0) {
    problems.push(
      `${missing.length} student${missing.length === 1 ? "" : "s"} in the saved allocation ${
        missing.length === 1 ? "is" : "are"
      } not in this file — check you uploaded the full codes CSV.`,
    );
  }
  return { rows, fromAllocation, fromFile, problems };
}

function describe(row: RosterRow): string {
  if (row.index != null) return `Student #${row.index}`;
  if (row.code) return `Login code ${row.code.slice(0, 5)}…`;
  return "A row in the file";
}
