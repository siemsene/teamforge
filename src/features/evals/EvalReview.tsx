import { useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getTeamByTokenHash, getTeamDirectoryDoc, publishEvalResults, saveTeamMgmt } from "../../lib/db";
import { eciesDecrypt, fromBase64 } from "../../lib/crypto";
import { importMemberKey, sealEnvelope } from "../../lib/memberKey";
import { openDirectoryNicknames } from "../../lib/nicknames";
import { publicTeamMgmt } from "../teams/contractTemplate";
import { reconcileBallot, validateSubmittedBallot } from "../../lib/evalValidation";
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

/** A ballot that was scored after being reconciled to the surviving team. */
interface AdjustedBallot {
  raterCodeIndex: number;
  teamLabel: string;
  dropped: { codeIndex: number; points: number }[];
  /** Everything they allocated went to teammates who have left, so an even
   * split was imputed for them instead. */
  neutralized: boolean;
}
import { UnlockPanel } from "../sessions/UnlockPanel";
import { rosterStaleness } from "../sessions/rosterStaleness";

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
          /** `scored` is reconciled to the surviving team; `submitted` is what
           * the student actually wrote, kept for the detail export. */
          byRater: Map<string, { scored: PeerEvalAnswers; submitted: PeerEvalAnswers }>;
          /** Members of each team who are still on the roster, keyed by label.
           * A student removed since provisioning is in the directory but not
           * here, and must not be rated, scored or published to. */
          currentByLabel: Map<string, TeamDirectory["teams"][number]["members"]>;
          /** Ballots excluded by the instructor-side re-check. */
          rejected: RejectedBallot[];
          /** Ballots kept, but rescored across the teammates who remain. */
          adjusted: AdjustedBallot[];
          /** Raters whose ballot carried no usable opinion after reconciling. */
          neutralized: number[];
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

  const stale = rosterStaleness(session, null);
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

      // A student can be removed from the session between provisioning and this
      // review. The directory still lists them, so it stays the record of the
      // roster each ballot was *written* against; the live student collection is
      // who is still here. Both are needed, and for different questions.
      const liveHashes = new Set(students.map((s) => s.hash));
      const currentByLabel = new Map<string, TeamDirectory["teams"][number]["members"]>();
      for (const team of directory.teams) {
        currentByLabel.set(team.label, team.members.filter((m) => liveHashes.has(m.codeHash)));
      }

      // Who each rater's ballot is allowed to talk about, from the roster we
      // hold — never from anything the ballot asserts about itself.
      //
      // Validation uses the roster as provisioned, plus any index retired since,
      // because that is what the student had in front of them. Judging a ballot
      // against a roster that changed after they submitted it would reject an
      // honest answer for our bookkeeping. Reconciliation to the survivors
      // happens after, never before — renormalizing first would make the
      // justification rule fire on numbers the student never typed.
      const retired = new Set(session.retiredCodeIndexes ?? []);
      const expectedByHash = new Map<string, { raterCodeIndex: number; teammateCodeIndexes: number[]; teamLabel: string }>();
      for (const team of directory.teams) {
        for (const m of team.members) {
          const known = team.members.filter((o) => o.codeIndex !== m.codeIndex).map((o) => o.codeIndex);
          expectedByHash.set(m.codeHash, {
            raterCodeIndex: m.codeIndex,
            teamLabel: team.label,
            teammateCodeIndexes: [...new Set([...known, ...retired])],
          });
        }
      }
      const validationConfig = {
        includeBehaviors: tm.includeBehaviors,
        behaviorCount: tm.behaviors.length,
        deadband: resolveFactorParams(tm).deadband,
      };

      const byRater = new Map<string, { scored: PeerEvalAnswers; submitted: PeerEvalAnswers }>();
      const rejected: RejectedBallot[] = [];
      const adjusted: AdjustedBallot[] = [];
      const neutralized: number[] = [];
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
        // Scored against the teammates who are still here. Points allocated to
        // someone who has left are dropped and the rest scaled back up, so what
        // the rater judged about the people still on the team is kept intact —
        // rather than the ballot being thrown out and everyone imputed an even
        // split, which is what used to happen.
        const survivors = (currentByLabel.get(expected.teamLabel) ?? [])
          .map((m) => m.codeIndex)
          .filter((idx) => idx !== expected.raterCodeIndex);
        const reconciled = reconcileBallot(answers, survivors);
        if (reconciled.dropped.length > 0) {
          adjusted.push({
            raterCodeIndex: s.codeIndex,
            teamLabel: expected.teamLabel,
            dropped: reconciled.dropped,
            neutralized: reconciled.noOpinion,
          });
        }
        if (reconciled.noOpinion) {
          // Nothing left to say about the survivors, so treat them as an even
          // split — the same neutral treatment silence gets. They did submit,
          // though, so record that separately.
          neutralized.push(expected.raterCodeIndex);
          continue;
        }
        byRater.set(s.hash, { scored: reconciled.answers, submitted: answers });
      }

      const nicknames = await openDirectoryNicknames(sid, directory.teams, (tokenHash) =>
        getTeamByTokenHash(sid, tokenHash),
      );
      setByRound((prev) => ({
        ...prev,
        [round]: {
          directory,
          byRater,
          currentByLabel,
          rejected,
          adjusted,
          neutralized,
          nicknames,
          computedFrom: submittedHashes.size,
        },
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
      // Only members still on the roster: a removed student must not be rated,
      // must not size the team, and must not be published to.
      const members = decrypted.currentByLabel.get(team.label) ?? team.members;
      const submissions: PeerEvalAnswers[] = [];
      for (const m of members) {
        const ans = decrypted.byRater.get(m.codeHash);
        if (ans) submissions.push(ans.scored);
      }
      const memberCodeIndexes = members.map((m) => m.codeIndex);
      const factors = computeTeamFactors(
        {
          teamLabel: team.label,
          memberCodeIndexes,
          submissions,
          submittedButNeutralized: decrypted.neutralized.filter((i) => memberCodeIndexes.includes(i)),
        },
        params,
      );
      return { team, members, factors };
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
      // Walk the *current* members, not the directory's. Publishing writes with
      // batch.update, and Firestore fails the whole batch when an update targets
      // a document that no longer exists — so a single student removed since
      // provisioning would block results for everyone in that chunk.
      for (let ti = 0; ti < results.length; ti++) {
        const factors = results[ti].factors;
        const byIdx = new Map(factors.members.map((m) => [m.codeIndex, m]));
        for (const member of results[ti].members) {
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
            teamLabel: factors.teamLabel,
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
      // Members the directory still lists who are no longer on the roster. They
      // were skipped deliberately — publishing writes with batch.update, which
      // fails the whole batch against a document that no longer exists — but a
      // silent skip would look like a successful publish to everyone.
      const departed =
        decrypted.directory.teams.reduce((n, t) => n + t.members.length, 0) -
        results.reduce((n, r) => n + r.members.length, 0);
      setInfo(
        `Published ${patches.length} result summaries. Students can now see their own factor.` +
          (departed > 0
            ? ` ${departed} student${departed === 1 ? "" : "s"} in the provisioned teams ${
                departed === 1 ? "is" : "are"
              } no longer on the roster, so nothing was published to them — re-upload your codes CSV on the Teams tab to bring the teams back in step.`
            : "") +
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

      {stale.teamRosterStale && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          Your roster has changed since teams were provisioned. Students who were removed are already left out of
          these factors, but their teammates are still being asked to rate them on the form — re-upload your
          login-codes CSV on the Teams tab before opening another round.
        </p>
      )}

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
              {decrypted.adjusted.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">
                    {decrypted.adjusted.length} ballot{decrypted.adjusted.length === 1 ? " was" : "s were"}{" "}
                    rescored around a teammate who has left the session.
                  </p>
                  <p className="mt-1">
                    These were kept, not excluded. Points allocated to someone no longer on the team are dropped and
                    the rest scaled back up to 100, so what the rater judged about the teammates who remain is
                    unchanged. The detail CSV shows both what was submitted and what was scored.
                  </p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">
                    {decrypted.adjusted.map((a) => (
                      <li key={`${a.teamLabel}:${a.raterCodeIndex}`}>
                        <strong>#{a.raterCodeIndex}</strong> ({a.teamLabel}):{" "}
                        {a.dropped.map((d) => `${d.points} pts to #${d.codeIndex}`).join(", ")}
                        {a.neutralized
                          ? " — nothing was left for the remaining teammates, so an even split was assumed."
                          : " redistributed."}
                      </li>
                    ))}
                  </ul>
                </div>
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
