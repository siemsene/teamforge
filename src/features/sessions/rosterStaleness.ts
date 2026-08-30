// Whether artifacts built from an earlier roster are now out of step with it.
//
// Two different questions, answered two different ways:
//
//   - The saved allocation and the provisioned teams are *encrypted*, so a tab
//     that has not been unlocked cannot look inside them. For those, compare
//     timestamps: session.rosterChangedAt against the plaintext half of each.
//   - The Allocation tab, once unlocked, holds both the live roster and the
//     decrypted assignment. There, answer exactly rather than by clock —
//     `allocationDrift` names who is adrift and in which direction.
//
// Pure module — no Firestore, no crypto.

import type { SessionDoc } from "../../types";

export interface RosterStaleness {
  /** A saved allocation predates the last roster change. */
  allocationStale: boolean;
  /** Teams were provisioned before the last roster change. */
  teamRosterStale: boolean;
}

/**
 * `allocationUpdatedAt` is AllocationDoc.updatedAt — the plaintext field —
 * rather than Allocation.solvedAt, which sits inside the ciphertext. Two
 * reasons: a locked tab can still warn, and solvedAt is when the *solver* ran,
 * which can precede the save by however long the instructor spent dragging
 * students around. Comparing against that would flag every hand-adjusted
 * allocation as stale.
 */
export function rosterStaleness(
  session: Pick<SessionDoc, "rosterChangedAt" | "teamMgmt">,
  allocationUpdatedAt: number | null,
): RosterStaleness {
  const changed = session.rosterChangedAt;
  // Sessions predating roster editing have no timestamp and nothing has changed
  // on them, so nothing is stale.
  if (changed == null) return { allocationStale: false, teamRosterStale: false };
  const provisioned = session.teamMgmt?.rosterUploadedAt ?? null;
  return {
    allocationStale: allocationUpdatedAt != null && changed > allocationUpdatedAt,
    teamRosterStale: provisioned != null && changed > provisioned,
  };
}

export interface AllocationDrift {
  /** Live students the saved allocation does not place — typically just added. */
  unassignedCodeIndexes: number[];
  /** Hashes the allocation still places that are no longer students at all. */
  ghostHashes: string[];
}

/** Exact drift between the live roster and a decrypted assignment. */
export function allocationDrift(
  students: { hash: string; codeIndex: number }[],
  assignment: Record<string, string[]>,
): AllocationDrift {
  const placed = new Set<string>();
  for (const hashes of Object.values(assignment)) for (const h of hashes) placed.add(h);
  const live = new Set(students.map((s) => s.hash));
  return {
    unassignedCodeIndexes: students
      .filter((s) => !placed.has(s.hash))
      .map((s) => s.codeIndex)
      .sort((a, b) => a - b),
    ghostHashes: [...placed].filter((h) => !live.has(h)).sort(),
  };
}
