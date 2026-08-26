import { useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getTeamByTokenHash, getTeamDirectoryDoc, publishEvalResults, saveTeamMgmt } from "../../lib/db";
import { eciesDecrypt, fromBase64 } from "../../lib/crypto";
import { importMemberKey, sealEnvelope } from "../../lib/memberKey";
import { openDirectoryNicknames } from "../../lib/nicknames";
import { publicTeamMgmt } from "../teams/contractTemplate";
import { validateSubmittedBallot } from "../../lib/evalValidation";
import { downloadFile, sessionFilename, toCsv } from "../../lib/util";
import { buildDetailRows, buildSummaryRows } from "../../lib/evalExport";
import {
  LOW_FACTOR_FLAG,
  MIN_RATERS_FOR_DETAIL,
  MIN_RATERS_TO_PUBLISH,
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

/** A decrypted ballot the instructor's own re-check rejected. */
interface RejectedBallot {
  raterCodeIndex: number;
  teamLabel: string;
  reasons: string[];
}
import { UnlockPanel } from "../sessions/UnlockPanel";

export function EvalReview() {
  const { sid, session, students, sessionKey, setSessionKey } = useSession();
  const tm = session.teamMgmt!;
  const [round, setRound] = useState<EvalRoundId>("formative");
  // Kept per round, so flipping between Practice and Graded does not throw away
  // work already done. Deliberately not persisted: these are decrypted
  // evaluations, and they should live no longer than this screen.
  const [byRound, setByRound] = useState<
    Partial<
      Record<
        EvalRoundId,
        {
          directory: TeamDirectory;
          byRater: Map<string, PeerEvalAnswers>;
          /** Ballots excluded by the instructor-side re-check. */
          rejected: RejectedBallot[];
          nicknames: Nicknames;
          /** Submissions at the moment this was computed, to spot staleness. */
          computedFrom: number;
        }
      >
    >
  >({});
  const decrypted = byRound[round] ?? null;
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

      // Who each rater's ballot is allowed to talk about, from the roster we
      // hold — never from anything the ballot asserts about itself.
      const expectedByHash = new Map<string, { raterCodeIndex: number; teammateCodeIndexes: number[]; teamLabel: string }>();
      for (const team of directory.teams) {
        for (const m of team.members) {
          expectedByHash.set(m.codeHash, {
            raterCodeIndex: m.codeIndex,
            teamLabel: team.label,
            teammateCodeIndexes: team.members.filter((o) => o.codeIndex !== m.codeIndex).map((o) => o.codeIndex),
          });
        }
      }
      const validationConfig = {
        includeBehaviors: tm.includeBehaviors,
        behaviorCount: tm.behaviors.length,
        deadband: resolveFactorParams(tm).deadband,
      };

      const byRater = new Map<string, PeerEvalAnswers>();
      const rejected: RejectedBallot[] = [];
      for (const s of students) {
        const sub = s[roundField];
        if (!sub) continue;
        let answers: PeerEvalAnswers;
        try {
          answers = JSON.parse(await eciesDecrypt(sessionKey, sub.payload)) as PeerEvalAnswers;
        } catch {
          rejected.push({
            raterCodeIndex: s.codeIndex,
            teamLabel: expectedByHash.get(s.hash)?.teamLabel ?? "—",
            reasons: ["Could not be decrypted or parsed."],
          });
          continue;
        }
        const expected = expectedByHash.get(s.hash);
        if (!expected) {
          rejected.push({
            raterCodeIndex: s.codeIndex,
            teamLabel: "—",
            reasons: ["Submitted a ballot but is not on any team in the roster."],
          });
          continue;
        }
        // The student's form checks this before submitting, but the form is the
        // only thing that does: the payload is encrypted, so the security rules
        // can never see inside it. Anything that fails here is excluded rather
        // than scored, which leaves the rater imputed at an even split — the
        // same neutral treatment a teammate who never submitted receives.
        const reasons = validateSubmittedBallot(answers, expected, validationConfig);
        if (reasons.length > 0) {
          rejected.push({ raterCodeIndex: s.codeIndex, teamLabel: expected.teamLabel, reasons });
          continue;
        }
        byRater.set(s.hash, answers);
      }

      const nicknames = await openDirectoryNicknames(sid, directory.teams, (tokenHash) =>
        getTeamByTokenHash(sid, tokenHash),
      );
      setByRound((prev) => ({
        ...prev,
        [round]: { directory, byRater, rejected, nicknames, computedFrom: submittedHashes.size },
      }));
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
    const { nicknames, directory, byRater } = decrypted;

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
    const publishParams = resolveFactorParams(tm);
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
          // Both guards key off *real* raters, never the imputed ballots that
          // stand in for teammates who stayed silent.
          const detailed = m.raterCount >= MIN_RATERS_FOR_DETAIL;
          // A factor is an invertible function of the share, so publishing one
          // computed from a single ballot hands the student that ballot. Hold
          // it at 1.00 and say so; the instructor keeps the real number below.
          const withheld = m.raterCount < MIN_RATERS_TO_PUBLISH;
          const view: EvalResultView = {
            round: round,
            teamLabel: team.label,
            raterCount: m.raterCount,
            neutralShare: m.neutralShare,
            share: detailed ? m.share : null,
            factor: withheld ? 1 : m.factor,
            factorWithheld: withheld || undefined,
            behaviorAverages: detailed && m.behaviorAverages ? m.behaviorAverages : undefined,
            behaviors: detailed && m.behaviorAverages ? tm.behaviors : undefined,
            factorFloor: publishParams.factorFloor,
            factorCeiling: publishParams.factorCeiling,
            note:
              !withheld && m.factor < LOW_FACTOR_FLAG
                ? "Your instructor will follow up before any grade is issued — nothing is finalized from this alone."
                : undefined,
          };
          const key = await importMemberKey(fromBase64(rawB64));
          patches.push({ hash: member.codeHash, result: await sealEnvelope(key, JSON.stringify(view)) });
        }
      }
      await publishEvalResults(sid, round, patches);
      const withheldCount = results
        .flatMap((r) => r.factors.members)
        .filter((m) => m.raterCount < MIN_RATERS_TO_PUBLISH).length;
      // Mark results as published in the config so students' cards reveal them.
      const next = {
        ...tm,
        rounds: {
          ...tm.rounds,
          [round]: { ...tm.rounds[round], resultsPublishedAt: Date.now() },
        },
      };
      await saveTeamMgmt(sid, next, publicTeamMgmt(next));
      setInfo(
        `Published ${patches.length} result summaries. Students can now see their own factor.` +
          (withheldCount > 0
            ? ` ${withheldCount} student${withheldCount === 1 ? " was" : "s were"} rated by fewer than ${MIN_RATERS_TO_PUBLISH} teammates, so ${withheldCount === 1 ? "their factor was" : "their factors were"} held at 1.00 — publishing it would have revealed a single teammate's ballot. Your table below still shows the computed value.`
            : ""),
      );
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
              onClick={() => setRound(r)}
            >
              {r === "formative" ? "Practice" : "Graded"}
            </Button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="text-slate-600">
          <strong className="text-slate-800">
            {submitted} of {total}
          </strong>{" "}
          students submitted this round.
        </p>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-100" /> submitted
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-slate-100" /> not yet
          </span>
        </span>
      </div>
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
              {busy ? "Working…" : decrypted ? "Recompute" : "Compute factors"}
            </Button>
            {decrypted && (
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
          {decrypted && results ? (
            <>
              {decrypted.computedFrom !== submitted && (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                  {submitted > decrypted.computedFrom
                    ? `${submitted - decrypted.computedFrom} more student${submitted - decrypted.computedFrom === 1 ? " has" : "s have"} submitted since you computed these.`
                    : `${decrypted.computedFrom - submitted} submission${decrypted.computedFrom - submitted === 1 ? " has" : "s have"} been withdrawn since you computed these.`}{" "}
                  Recompute to bring them up to date.
                </p>
              )}
              {decrypted.rejected.length > 0 && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <p className="font-medium">
                    {decrypted.rejected.length} ballot{decrypted.rejected.length === 1 ? "" : "s"} failed validation and
                    {decrypted.rejected.length === 1 ? " was" : " were"} excluded.
                  </p>
                  <p className="mt-1">
                    Peer evaluations are encrypted, so the server cannot check them on the way in — they are checked
                    here instead. An excluded rater counts as an even split for everyone they were meant to rate, the
                    same as a teammate who never submitted. Ask them to submit again while the round is open.
                  </p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">
                    {decrypted.rejected.map((r) => (
                      <li key={`${r.teamLabel}:${r.raterCodeIndex}`}>
                        <strong>#{r.raterCodeIndex}</strong> ({r.teamLabel}): {r.reasons.join(" ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <FactorTable results={results} nicknames={decrypted.nicknames} />
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              Factors are worked out in your browser from the encrypted submissions and are never stored, so they are
              not kept between visits — computing them again takes one click and changes nothing.
            </p>
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
          {/* Each team is its own table, so without fixed widths the columns
              drift from one team to the next and the page reads as ragged.
              A shared colgroup lines them all up. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[27%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[15%]" />
              <col className="w-[11%]" />
              <col className="w-[25%]" />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Student</th>
                <th className="px-3 py-1.5 text-right font-medium">Raters</th>
                <th className="px-3 py-1.5 text-right font-medium">Share</th>
                <th className="px-3 py-1.5 text-right font-medium">Dropped</th>
                <th className="px-3 py-1.5 text-right font-medium">Factor</th>
                <th className="px-3 py-1.5 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {factors.members.map((m) => (
                <tr
                  key={m.codeIndex}
                  className={`border-t border-slate-100 ${m.flags.includes("lowFactor") ? "bg-red-50" : ""}`}
                >
                  <td className="break-words px-3 py-1.5">{nameByIdx.get(m.codeIndex) ?? `#${m.codeIndex}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {m.raterCount}
                    {m.imputedCount > 0 && (
                      <span
                        className="ml-1 text-xs text-slate-400"
                        title={`${m.imputedCount} teammate(s) did not submit; an even split was assumed for them.`}
                      >
                        +{m.imputedCount}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m.share.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500">
                    {m.trimmedLow != null && m.trimmedHigh != null
                      ? `${m.trimmedLow.toFixed(2)} / ${m.trimmedHigh.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{m.factor.toFixed(2)}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {m.flags.includes("lowFactor") && <Badge tone="red">below 0.90</Badge>}
                      {m.flags.includes("unanimousLow") && (
                        <span title="Everyone rated this member the same and low. That is what a genuine free rider looks like — and what a coordinated dump looks like. Worth a conversation either way.">
                          <Badge tone="amber">unanimous</Badge>
                        </span>
                      )}
                      {m.flags.includes("noSubmission") && <Badge tone="gray">no ballot</Badge>}
                      {m.flags.includes("noRatings") && <Badge tone="gray">no ratings</Badge>}
                      {m.raterCount < MIN_RATERS_TO_PUBLISH && (
                        <span title="Too few teammates rated this student for a factor to be returned without giving away what one of them said. They were shown 1.00; the figure in this table is the real one.">
                          <Badge tone="gray">not shown to student</Badge>
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td className="px-3 py-1.5 text-xs text-slate-500" colSpan={4}>
                  Team mean — exactly 1.00 unless someone genuinely under-contributed
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-600">
                  {factors.teamMean.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  );
}
