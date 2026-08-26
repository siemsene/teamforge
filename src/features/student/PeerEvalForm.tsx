import { useMemo, useState } from "react";
import {
  evenSplit as buildEvenSplit,
  needsJustification,
  neutralRange,
  pruneJustifications,
  validatePeerEval,
} from "../../lib/evalValidation";
import type { EvalRoundId, Nicknames, PeerEvalAnswers, PublicTeamMgmt, RosterInfo } from "../../types";
import { displayName } from "../../lib/nicknames";
import { Button, Input, TextArea } from "../../components/ui";

/**
 * The fixed three-part peer-evaluation form (100-point allocation, optional
 * behavior matrix, optional confidential comment). Validation mirrors the
 * published spec; only the presentation lives here.
 *
 * Two things drive the layout. The hard part of a fixed budget is not deciding
 * who contributed what, it is making the numbers add to 100 — so the form opens
 * already on an even split (the neutral answer, and a valid one), every row has
 * a stepper, and a running counter says how far from 100 you are at all times.
 * And the comparison is inherently relative, so each row carries a bar against
 * the even split: whether somebody is above or below it should be visible
 * without doing arithmetic.
 */
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

  const evenSplit = useMemo(
    () => buildEvenSplit(teammates.map((t) => t.codeIndex)),
    [teammates],
  );

  // Opens on the even split rather than blank: it is the neutral answer, it is
  // already valid, and it gives every adjustment a reference point.
  const [points, setPoints] = useState<Record<string, number>>(evenSplit);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [behaviors, setBehaviors] = useState<Record<string, number[]>>({});
  const [comment, setComment] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  // The band around an even split within which an allocation changes nobody's
  // factor -- and so needs no justification. Widens or narrows with team size.
  const band = useMemo(
    () => neutralRange(teammates.length, tm.deadband),
    [teammates.length, tm.deadband],
  );

  const total = useMemo(
    () => teammates.reduce((sum, t) => sum + (points[String(t.codeIndex)] ?? 0), 0),
    [points, teammates],
  );
  const remaining = 100 - total;

  const ratingsNeeded = teammates.length * tm.behaviors.length;
  const ratedCount = useMemo(
    () =>
      teammates.reduce(
        (n, t) => n + (behaviors[String(t.codeIndex)] ?? []).filter((v) => v >= 1 && v <= 5).length,
        0,
      ),
    [behaviors, teammates],
  );

  const setPoint = (codeIndex: number, value: number) =>
    setPoints((p) => ({ ...p, [String(codeIndex)]: Math.max(0, Math.min(100, value)) }));

  function buildAnswers(): PeerEvalAnswers {
    const pts: Record<string, number> = {};
    teammates.forEach((t) => (pts[String(t.codeIndex)] = points[String(t.codeIndex)] ?? 0));
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
    const found = validatePeerEval(answers, teammates.map((t) => t.codeIndex), {
      includeBehaviors: tm.includeBehaviors,
      behaviorCount: tm.behaviors.length,
      deadband: tm.deadband,
    });
    setProblems(found);
    if (found.length === 0) onSubmit(answers);
  }

  const budgetTone =
    remaining === 0
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : remaining > 0
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-800";

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-semibold">Part 1 — Split 100 points across your teammates</h3>
        <p className="mb-3 text-sm text-slate-600">
          Not yourself. It starts on an even split, which is the neutral answer and a perfectly good one — if everyone
          pulled their weight, leave it as it is.{" "}
          {teammates.length > 1 && (
            <>
              Anything from {band.low} to {band.high} still counts as even and changes nobody&rsquo;s grade; outside
              that it does, so it asks you for one sentence.
            </>
          )}{" "}
          <a
            className="text-indigo-600 hover:underline"
            href="/peer-eval-team-factor.xlsx"
            target="_blank"
            rel="noopener noreferrer"
          >
            How your own factor is worked out
          </a>
          .
        </p>

        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${budgetTone}`}
          aria-live="polite"
        >
          <span className="font-medium">
            {remaining === 0
              ? "All 100 points allocated"
              : remaining > 0
                ? `${remaining} point${remaining === 1 ? "" : "s"} still to allocate`
                : `${-remaining} point${remaining === -1 ? "" : "s"} too many`}
          </span>
          <Button variant="ghost" type="button" onClick={() => setPoints(evenSplit)}>
            Reset to an even split
          </Button>
        </div>

        <div className="space-y-2">
          {teammates.map((t) => {
            const key = String(t.codeIndex);
            const value = points[key] ?? 0;
            const even = evenSplit[key];
            const needsWhy = needsJustification(value, teammates.length, tm.deadband);
            return (
              <div
                key={t.codeIndex}
                className={`rounded-md border p-3 ${needsWhy ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="min-w-32 flex-1 text-sm font-medium">
                    {displayName(t.codeIndex, nicknames)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      type="button"
                      aria-label={`One point fewer for ${displayName(t.codeIndex, nicknames)}`}
                      className="w-9"
                      onClick={() => setPoint(t.codeIndex, value - 1)}
                    >
                      −
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      inputMode="numeric"
                      className="w-20 text-center"
                      aria-label={`Points for ${displayName(t.codeIndex, nicknames)}`}
                      value={String(value)}
                      onChange={(e) => setPoint(t.codeIndex, Number(e.target.value) || 0)}
                    />
                    <Button
                      variant="secondary"
                      type="button"
                      aria-label={`One point more for ${displayName(t.codeIndex, nicknames)}`}
                      className="w-9"
                      onClick={() => setPoint(t.codeIndex, value + 1)}
                    >
                      +
                    </Button>
                  </div>
                  <ShareBar value={value} even={even} />
                  <span
                    className={`w-16 text-right text-xs font-medium ${
                      value === even ? "text-slate-500" : value > even ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {value === even ? "even" : value > even ? `+${value - even}` : `${value - even}`}
                  </span>
                </div>

                {needsWhy && (
                  <label className="mt-2 block">
                    <span className="text-xs font-medium text-amber-900">
                      Outside {band.low}–{band.high}, so this changes their grade. One sentence on why:
                    </span>
                    <Input
                      className="mt-1"
                      placeholder={
                        value > even
                          ? "e.g. rebuilt the analysis after the data changed, over a weekend"
                          : "e.g. missed all three milestone meetings"
                      }
                      value={justifications[key] ?? ""}
                      onChange={(e) => setJustifications((j) => ({ ...j, [key]: e.target.value }))}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {tm.includeBehaviors && (
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">Part 2 — How often did each teammate do these?</h3>
            <span className={`text-xs ${ratedCount === ratingsNeeded ? "text-emerald-700" : "text-slate-500"}`}>
              {ratedCount} of {ratingsNeeded} rated
            </span>
          </div>
          <p className="mb-3 -mt-2 text-sm text-slate-600">1 = never, 5 = consistently.</p>
          {/* Grouped by behaviour, not by teammate: each of these sentences is
              long, and repeating it once per teammate made this section several
              times taller than the rest of the form put together. */}
          <div className="space-y-3">
            {tm.behaviors.map((b, bi) => (
              <div key={bi} className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-sm text-slate-700">{b}</p>
                <div className="space-y-1.5">
                  {teammates.map((t) => {
                    const key = String(t.codeIndex);
                    return (
                      <div key={t.codeIndex} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-slate-600">{displayName(t.codeIndex, nicknames)}</span>
                        <RatingScale
                          label={`${displayName(t.codeIndex, nicknames)} — ${b}`}
                          value={behaviors[key]?.[bi] ?? 0}
                          onChange={(n) =>
                            setBehaviors((prev) => {
                              const row = [...(prev[key] ?? new Array(tm.behaviors.length).fill(0))];
                              row[bi] = n;
                              return { ...prev, [key]: row };
                            })
                          }
                        />
                      </div>
                    );
                  })}
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

      {problems.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-medium">
            {problems.length === 1 ? "One thing to fix:" : `${problems.length} things to fix:`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={submit} disabled={busy}>
        {busy ? "Submitting…" : "Submit evaluation"}
      </Button>
    </div>
  );
}

/**
 * A teammate's share against the even split, which sits at the halfway tick.
 * Decorative — the number beside it is the accessible value — but it turns "is
 * this person above or below even?" into something seen rather than computed.
 * Deliberately small and inline: a full-width bar under the row read as a
 * divider rather than as data.
 */
function ShareBar({ value, even }: { value: number; even: number }) {
  const width = Math.min(100, (value / (even * 2)) * 100);
  const tone = value === even ? "bg-slate-300" : value > even ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-400/60" />
    </div>
  );
}

/** 1–5 as one-click buttons rather than a dropdown per behaviour per teammate. */
function RatingScale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} out of 5`}
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-md border text-sm font-medium transition-colors ${
            value === n
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-slate-300 bg-white text-slate-600 hover:border-indigo-400 hover:bg-indigo-50"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
