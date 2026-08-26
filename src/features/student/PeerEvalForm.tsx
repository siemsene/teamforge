import { useMemo, useState } from "react";
import {
  needsJustification,
  neutralRange,
  pruneJustifications,
  validatePeerEval,
} from "../../lib/evalValidation";
import type { EvalRoundId, Nicknames, PeerEvalAnswers, PublicTeamMgmt, RosterInfo } from "../../types";
import { displayName } from "../../lib/nicknames";
import { Button, ErrorText, Input, Select, TextArea } from "../../components/ui";

/** The fixed three-part peer-evaluation form (100-point allocation, optional
 * behavior matrix, optional confidential comment). Validation mirrors the
 * published spec. */
export function PeerEvalForm({
  roster,
  nicknames,
  tm,
  round,
  busy,
  onSubmit,
}: {
  roster: RosterInfo;
  nicknames: Nicknames;
  tm: PublicTeamMgmt;
  round: EvalRoundId;
  busy: boolean;
  onSubmit: (answers: PeerEvalAnswers) => void;
}) {
  const teammates = roster.teammates;
  const [points, setPoints] = useState<Record<string, string>>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [behaviors, setBehaviors] = useState<Record<string, number[]>>({});
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  // The band around an even split within which an allocation changes nobody's
  // factor -- and so needs no justification. Widens or narrows with team size.
  const band = useMemo(
    () => neutralRange(teammates.length, tm.deadband),
    [teammates.length, tm.deadband],
  );

  const total = useMemo(
    () => teammates.reduce((sum, t) => sum + (Number(points[String(t.codeIndex)]) || 0), 0),
    [points, teammates],
  );

  function splitEvenly() {
    const each = Math.floor(100 / teammates.length);
    let remainder = 100 - each * teammates.length;
    const next: Record<string, string> = {};
    teammates.forEach((t) => {
      const bump = remainder > 0 ? 1 : 0;
      remainder -= bump;
      next[String(t.codeIndex)] = String(each + bump);
    });
    setPoints(next);
  }

  function buildAnswers(): PeerEvalAnswers {
    const pts: Record<string, number> = {};
    teammates.forEach((t) => (pts[String(t.codeIndex)] = Number(points[String(t.codeIndex)]) || 0));
    const answers: PeerEvalAnswers = {
      round,
      raterCodeIndex: roster.codeIndex,
      teamLabel: roster.teamLabel,
      points: pts,
      // Drop anything left over from an earlier edit: a justification only
      // belongs with an allocation that still sits outside the dead band.
      justifications: pruneJustifications(
        pts,
        justifications,
        teammates.map((t) => t.codeIndex),
        tm.deadband,
      ),
    };
    if (tm.includeBehaviors) answers.behaviorRatings = behaviors;
    if (comment.trim()) answers.commentToInstructor = comment.trim();
    return answers;
  }

  function submit() {
    const answers = buildAnswers();
    const problems = validatePeerEval(answers, teammates.map((t) => t.codeIndex), {
      includeBehaviors: tm.includeBehaviors,
      behaviorCount: tm.behaviors.length,
      deadband: tm.deadband,
    });
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }
    setError("");
    onSubmit(answers);
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="font-semibold">Part 1 — Allocate 100 points across your teammates</h3>
        <p className="mb-2 text-sm text-slate-600">
          Do not include yourself. An equal split is the default and the neutral answer — if everyone pulled their
          weight, say so and you are done.{" "}
          {teammates.length > 1 && (
            <>
              Anything from {band.low} to {band.high} counts as an even split and changes nobody&rsquo;s grade.
              Going outside that range does change it, so it needs one sentence saying why.
            </>
          )}{" "}
          <a
            className="text-indigo-600 hover:underline"
            href="/peer-eval-team-factor.xlsx"
            target="_blank"
            rel="noopener noreferrer"
          >
            See exactly how your own factor is worked out
          </a>
          .
        </p>
        <div className="space-y-2">
          {teammates.map((t) => {
            const v = points[String(t.codeIndex)] ?? "";
            const need = v !== "" && needsJustification(Number(v) || 0, teammates.length, tm.deadband);
            return (
              <div key={t.codeIndex} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-sm">{displayName(t.codeIndex, nicknames)}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-24"
                    value={v}
                    onChange={(e) => setPoints((p) => ({ ...p, [String(t.codeIndex)]: e.target.value }))}
                  />
                </div>
                {need && (
                  <Input
                    className="mt-2"
                    placeholder={`Outside ${band.low}-${band.high}: one sentence of justification (required)`}
                    value={justifications[String(t.codeIndex)] ?? ""}
                    onChange={(e) =>
                      setJustifications((j) => ({ ...j, [String(t.codeIndex)]: e.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <Button variant="ghost" onClick={splitEvenly} type="button">
            Split evenly
          </Button>
          <span className={total === 100 ? "text-green-700" : "text-amber-700"}>Total: {total} / 100</span>
        </div>
      </section>

      {tm.includeBehaviors && (
        <section>
          <h3 className="font-semibold">Part 2 — Rate each teammate 1 (never) to 5 (consistently)</h3>
          <div className="mt-2 space-y-3">
            {teammates.map((t) => (
              <div key={t.codeIndex} className="rounded-md border border-slate-200 p-2">
                <p className="mb-1 text-sm font-medium">{displayName(t.codeIndex, nicknames)}</p>
                <div className="space-y-1">
                  {tm.behaviors.map((b, bi) => (
                    <div key={bi} className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-slate-600">{b}</span>
                      <Select
                        value={behaviors[String(t.codeIndex)]?.[bi] ?? ""}
                        onChange={(e) =>
                          setBehaviors((prev) => {
                            const row = [...(prev[String(t.codeIndex)] ?? new Array(tm.behaviors.length).fill(0))];
                            row[bi] = Number(e.target.value);
                            return { ...prev, [String(t.codeIndex)]: row };
                          })
                        }
                      >
                        <option value="">–</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="font-semibold">Part 3 — Optional and confidential</h3>
        <p className="mb-1 text-sm text-slate-600">
          Anything your instructor should know that the numbers don't capture? Your teammates never see this.
        </p>
        <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </section>

      <ErrorText>{error}</ErrorText>
      <Button onClick={submit} disabled={busy}>
        {busy ? "Submitting…" : "Submit evaluation"}
      </Button>
    </div>
  );
}
