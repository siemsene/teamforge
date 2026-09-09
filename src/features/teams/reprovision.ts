// The one write path for changing provisioned teams — whether the change came
// from a CSV re-upload or from a single click on the Teams tab.
//
// Ordering matters here, and for two different reasons:
//
//   - `rosterUploadedAt` is compared against `rosterChangedAt` to decide whether
//     the teams are out of step with the roster. It is stamped with the moment
//     this run *started*, not the moment it finished: a student removed in
//     another tab while the rebuild was running is not in what we wrote, and a
//     finish-time stamp would hide that.
//   - A failure partway through leaves some roster blobs rewritten and others
//     not. Bumping `rosterChangedAt` on the way out makes the stale banner
//     appear, and the banner's "Update teams now" rebuilds everything from the
//     directory — which is idempotent, so a retry is always safe.

import {
  clearNickname,
  provisionRoster,
  saveTeamDirectory,
  saveTeamMgmt,
  updateSession,
  withdrawPeerEval,
} from "../../lib/db";
import type { EvalRoundId, SessionDoc, StudentDoc, TeamDirectory, TeamMgmtConfig } from "../../types";
import { hashTeamToken } from "../../lib/memberKey";
import { defaultTeamMgmtConfig, publicTeamMgmt } from "./contractTemplate";
import { buildProvisioning, type ResolvedTeam } from "./provision";
import { movedMembers } from "./teamEdit";

const ROUNDS: EvalRoundId[] = ["formative", "summative"];
const SUBMISSION_FIELD: Record<EvalRoundId, "peerEvalFormative" | "peerEvalSummative"> = {
  formative: "peerEvalFormative",
  summative: "peerEvalSummative",
};

export interface ReprovisionOptions {
  onProgress?: (done: number, total: number) => void;
  /** Live student docs, for the moved students' open-round ballots. */
  students?: (Pick<StudentDoc, "peerEvalFormative" | "peerEvalSummative"> & { hash: string })[];
}

/**
 * Seals and writes `teams`, keeping every surviving team's token (contract,
 * display names) via `previous`. Returns the new directory in the clear.
 */
export async function reprovisionTeams(
  sid: string,
  session: Pick<SessionDoc, "wrappedKeys" | "teamMgmt">,
  previous: TeamDirectory | null,
  teams: ResolvedTeam[],
  opts: ReprovisionOptions = {},
): Promise<TeamDirectory> {
  const startedAt = Date.now();
  const built = await buildProvisioning(sid, session.wrappedKeys.publicKeyJwk, teams, opts.onProgress, previous);

  try {
    await provisionRoster(sid, built.studentPatches, built.teamDocs, built.staleTokenHashes);
    await saveTeamDirectory(sid, built.directoryPayload);
    const config: TeamMgmtConfig = { ...(session.teamMgmt ?? defaultTeamMgmtConfig()), rosterUploadedAt: startedAt };
    await saveTeamMgmt(sid, config, publicTeamMgmt(config));

    // Housekeeping for anyone who changed team. Neither write is load-bearing
    // for the roster itself, so they come after the directory is safely down.
    if (previous) {
      const openRounds = ROUNDS.filter((r) => session.teamMgmt?.rounds[r].status === "open");
      for (const moved of movedMembers(previous, teams)) {
        await clearNickname(sid, await hashTeamToken(moved.fromToken), moved.codeIndex).catch(() => {});
        const student = opts.students?.find((s) => s.hash === moved.codeHash);
        for (const r of openRounds) {
          // Their ballot was about the old team. Left in place it would fail
          // validation at review and their hub would say "submitted", so they
          // would never be asked again.
          if (student?.[SUBMISSION_FIELD[r]]) await withdrawPeerEval(sid, moved.codeHash, r);
        }
      }
    }
  } catch (e) {
    await updateSession(sid, { rosterChangedAt: Date.now() }).catch(() => {});
    throw e;
  }
  return built.directory;
}
