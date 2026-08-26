import { useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getTeamByTokenHash, getTeamDirectoryDoc, publishEvalResults, saveTeamMgmt } from "../../lib/db";
import { eciesDecrypt, fromBase64 } from "../../lib/crypto";
import { importMemberKey, sealEnvelope } from "../../lib/memberKey";
import { openDirectoryNicknames } from "../../lib/nicknames";
import { publicTeamMgmt } from "../teams/contractTemplate";
import { downloadFile, sessionFilename, toCsv } from "../../lib/util";
import { buildDetailRows, buildSummaryRows } from "../../lib/evalExport";
import {
  LOW_FACTOR_FLAG,
  computeTeamFactors,
  resolveFactorParams,
  type TeamFactorResult,
} from "../../lib/teamFactor";
import type {
  AesEnvelope,
  EvalResultView,
  EvalRoundId,
  Nicknames,
  PeerEvalAnswers,
  TeamDirectory,
} from "../../types";
import { Badge, Button, Card, ErrorText } from "../../components/ui";
import { UnlockPanel } from "../sessions/UnlockPanel";

export function EvalReview() {
  const { sid, session, students, sessionKey, setSessionKey } = useSession();
  const tm = session.teamMgmt!;
  const [round, setRound] = useState<EvalRoundId>("formative");
  const [decrypted, setDecrypted] = useState<{
    round: EvalRoundId;
    directory: TeamDirectory;
    byRater: Map<string, PeerEvalAnswers>;
    nicknames: Nicknames;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const roundField = round === "formative" ? "peerEvalFormative" : "peerEvalSummative";
  const submittedHashes = useMemo(
    () => new Set(students.filter((s) => s[roundField]).map((s) => s.hash)),
    [students, roundField],
  );

  async function review() {
    if (!sessionKey) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const dirDoc = await getTeamDirectoryDoc(sid);
      if (!dirDoc) throw new Error("No team directory — re-provision the roster on the Teams tab.");
      const directory = JSON.parse(await eciesDecrypt(sessionKey, dirDoc.payload)) as TeamDirectory;
      const byRater = new Map<string, PeerEvalAnswers>();
      for (const s of students) {
        const sub = s[roundField];
        if (sub) {
          try {
            byRater.set(s.hash, JSON.parse(await eciesDecrypt(sessionKey, sub.payload)) as PeerEvalAnswers);
          } catch {
            /* skip unreadable submission */
          }
        }
      }
      const nicknames = await openDirectoryNicknames(sid, directory.teams, (tokenHash) =>
        getTeamByTokenHash(sid, tokenHash),
      );
      setDecrypted({ round, directory, byRater, nicknames });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const results = useMemo(() => {
    if (!decrypted) return null;
    const params = resolveFactorParams(tm);
    return decrypted.directory.teams.map((team) => {
      const submissions: PeerEvalAnswers[] = [];
      for (const m of team.members) {
        const ans = decrypted.byRater.get(m.codeHash);
        if (ans) submissions.push(ans);
      }
      const factors = computeTeamFactors(
        { teamLabel: team.label, memberCodeIndexes: team.members.map((m) => m.codeIndex), submissions },
        params,
      );
      return { team, factors };
    });
  }, [decrypted, tm.factorFloor, tm.factorCeiling, tm.deadband, tm.damping]);

  function exportCsv() {
    if (!decrypted || !results) return;
    const { nicknames, directory, byRater, round } = decrypted;

    downloadFile(
      sessionFilename(session.title, sid, `peer-eval-${round}.csv`),
      toCsv(
        buildSummaryRows(results, nicknames, {
          includeBehaviors: tm.includeBehaviors,
          behaviors: tm.behaviors,
        }),
      ),
      "text/csv",
    );

    downloadFile(
      sessionFilename(session.title, sid, `peer-eval-${round}-detail.csv`),
      toCsv(buildDetailRows(directory.teams, byRater, nicknames)),
      "text/csv",
    );
  }

  async function publish() {
    if (!decrypted || !results) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const patches: { hash: string; result: AesEnvelope }[] = [];
      for (let ti = 0; ti < decrypted.directory.teams.length; ti++) {
        const team = decrypted.directory.teams[ti];
        const factors = results[ti].factors;
        const byIdx = new Map(factors.members.map((m) => [m.codeIndex, m]));
        for (const member of team.members) {
          const m = byIdx.get(member.codeIndex);
          if (!m) continue;
          const rawB64 = decrypted.directory.memberKeys[member.codeHash];
          if (!rawB64) continue;
          const view: EvalResultView = {
            round: decrypted.round,
            teamLabel: team.label,
            raterCount: m.raterCount,
            neutralShare: m.neutralShare,
            // Anonymity guard: keyed to *real* raters, never the imputed
            // ballots that stand in for teammates who stayed silent.
            share: m.raterCount >= 3 ? m.share : null,
            factor: m.factor,
            behaviorAverages: m.raterCount >= 3 && m.behaviorAverages ? m.behaviorAverages : undefined,
            note:
              m.factor < LOW_FACTOR_FLAG
                ? "Your instructor will follow up before any grade is issued — nothing is finalized from this alone."
                : undefined,
          };
          const key = await importMemberKey(fromBase64(rawB64));
          patches.push({ hash: member.codeHash, result: await sealEnvelope(key, JSON.stringify(view)) });
        }
      }
      await publishEvalResults(sid, decrypted.round, patches);
      // Mark results as published in the config so students' cards reveal them.
      const next = {
        ...tm,
        rounds: {
          ...tm.rounds,
          [decrypted.round]: { ...tm.rounds[decrypted.round], resultsPublishedAt: Date.now() },
        },
      };
      await saveTeamMgmt(sid, next, publicTeamMgmt(next));
      setInfo(`Published ${patches.length} result summaries. Students can now see their own factor.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = students.length;
  const submitted = submittedHashes.size;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Review &amp; results</h2>
        <div className="flex gap-1">
          {(["formative", "summative"] as EvalRoundId[]).map((r) => (
            <Button
              key={r}
              variant={round === r ? "primary" : "secondary"}
              onClick={() => {
                setRound(r);
                setDecrypted(null);
              }}
            >
              {r === "formative" ? "Practice" : "Graded"}
            </Button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-sm text-slate-600">
        {submitted} of {total} students submitted this round. Tiles are anonymous until you unlock.
      </p>
      <div className="mb-4 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
        {students.map((s) => (
          <div
            key={s.hash}
            title={s[roundField] ? "Submitted" : "Not submitted"}
            className={`rounded-md px-2 py-1.5 text-center text-xs font-medium ${
              s[roundField] ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"
            }`}
          >
            #{s.codeIndex}
          </div>
        ))}
      </div>

      {!sessionKey ? (
        <UnlockPanel
          wrapped={session.wrappedKeys}
          title="Unlock to compute factors"
          intro="Evaluations are encrypted. Enter your passphrase (or recovery key) to compute team factors in this browser."
          onUnlocked={setSessionKey}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={review} disabled={busy}>
              {busy ? "Working…" : decrypted?.round === round ? "Recompute" : "Compute factors"}
            </Button>
            {decrypted?.round === round && (
              <>
                <Button variant="secondary" onClick={exportCsv}>
                  Export CSV
                </Button>
                <Button variant="secondary" onClick={publish} disabled={busy}>
                  Publish {round === "formative" ? "practice" : "graded"} results to students
                </Button>
              </>
            )}
          </div>
          <ErrorText>{error}</ErrorText>
          {info && <p className="mt-2 text-sm text-green-700">{info}</p>}
          {decrypted?.round === round && results && (
            <FactorTable results={results} nicknames={decrypted.nicknames} />
          )}
        </>
      )}
    </Card>
  );
}

function FactorTable({
  results,
  nicknames,
}: {
  results: { team: TeamDirectory["teams"][number]; factors: TeamFactorResult }[];
  nicknames: Nicknames;
}) {
  const nameByIdx = useMemo(() => {
    const m = new Map<number, string>();
    Object.entries(nicknames).forEach(([idx, name]) => m.set(Number(idx), name));
    return m;
  }, [nicknames]);

  return (
    <div className="mt-4 space-y-4">
      {results.map(({ factors }) => (
        <div key={factors.teamLabel} className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <span className="font-medium">{factors.teamLabel}</span>
            <span className="flex items-center gap-2">
              {factors.spreadFlagged && <Badge tone="amber">spread {factors.spread.toFixed(2)}</Badge>}
              {factors.members.some((m) => m.flags.includes("unanimousLow")) && (
                <Badge tone="amber">unanimous low</Badge>
              )}
            </span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-1">Student</th>
                <th className="px-3 py-1">Raters</th>
                <th className="px-3 py-1">Share</th>
                <th className="px-3 py-1">Trimmed</th>
                <th className="px-3 py-1">Factor</th>
              </tr>
            </thead>
            <tbody>
              {factors.members.map((m) => (
                <tr key={m.codeIndex} className={`border-t border-slate-100 ${m.flags.includes("lowFactor") ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-1">{nameByIdx.get(m.codeIndex) ?? `#${m.codeIndex}`}</td>
                  <td className="px-3 py-1">
                    {m.raterCount}
                    {m.imputedCount > 0 && (
                      <span className="ml-1 text-xs text-slate-500" title="Teammates who did not submit; an even split was assumed for them.">
                        +{m.imputedCount} assumed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1">{m.share.toFixed(2)}</td>
                  <td className="px-3 py-1 text-xs text-slate-500">
                    {m.trimmedLow != null && m.trimmedHigh != null
                      ? `${m.trimmedLow.toFixed(2)} / ${m.trimmedHigh.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-1 font-medium">
                    {m.factor.toFixed(2)}
                    {m.flags.includes("lowFactor") && <span className="ml-1 text-xs text-red-600">flag</span>}
                    {m.flags.includes("unanimousLow") && (
                      <span
                        className="ml-1 text-xs text-amber-700"
                        title="Everyone rated this member the same and low. That is what a genuine free rider looks like — and what a coordinated dump looks like. Worth a conversation either way."
                      >
                        unanimous
                      </span>
                    )}
                    {m.flags.includes("noSubmission") && (
                      <span className="ml-1 text-xs text-slate-500">did not submit</span>
                    )}
                    {m.flags.includes("noRatings") && <span className="ml-1 text-xs text-slate-500">no ratings</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-xs text-slate-500">
              <tr className="border-t border-slate-200">
                <td className="px-3 py-1" colSpan={4}>
                  Team mean — 1.00 unless someone genuinely under-contributed
                </td>
                <td className="px-3 py-1 font-medium">{factors.teamMean.toFixed(3)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  );
}
