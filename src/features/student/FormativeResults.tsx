import { useEffect, useState } from "react";
import { openEnvelope } from "../../lib/memberKey";
import type { AesEnvelope, EvalResultView } from "../../types";
import { Card, Spinner } from "../../components/ui";
import { behaviourScores, factorEffect, factorMeaning, gaugePercent } from "./resultView";

const ROUND_LABEL: Record<string, string> = {
  formative: "practice round",
  summative: "graded round",
};

/**
 * A student's own published evaluation results.
 *
 * The stored view is a handful of bare numbers, and bare numbers do not
 * explain themselves: a list of behaviour averages says nothing about which
 * average belongs to which behaviour, and a factor of 1.05 means nothing
 * without the range it sits in. Each figure is shown against what it measures.
 *
 * Per-share detail and behaviour averages appear only when at least three
 * teammates rated them, and the factor itself is withheld below two, so no
 * single rater's answer can be inferred from any figure shown here.
 */
export function FormativeResults({
  memberKey,
  envelope,
  behaviors,
}: {
  memberKey: CryptoKey;
  envelope: AesEnvelope;
  /** Live config labels, used for results published before labels were stored. */
  behaviors: string[];
}) {
  const [view, setView] = useState<EvalResultView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setView(JSON.parse(await openEnvelope(memberKey, envelope)) as EvalResultView);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [memberKey, envelope]);

  if (error)
    return (
      <Card>
        <p className="text-sm text-red-600">Could not read your results: {error}</p>
      </Card>
    );
  if (!view) return <Spinner label="Loading your results…" />;

  // `share` is the current field; `adjustedMeanPoints` (in points) is what
  // results published before the dead-band redesign carry.
  const share = view.share ?? null;
  const legacyPoints = view.adjustedMeanPoints ?? null;
  const detailed = share != null || legacyPoints != null;

  const floor = view.factorFloor ?? 0.7;
  const ceiling = view.factorCeiling ?? 1.05;
  const scores = behaviourScores(view.behaviorAverages, view.behaviors, behaviors);

  const evenPercent = gaugePercent(1, floor, ceiling);
  const tone =
    view.factor > 1 ? "text-emerald-700" : view.factor < 1 ? "text-amber-700" : "text-slate-800";

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Your results — {ROUND_LABEL[view.round] ?? view.round}</h2>

      {view.factorWithheld ? (
        // A factor is worked back to the share it came from with simple
        // arithmetic, and with one ballot that share *is* what that teammate
        // said. Showing a number here would hand it over, so there is none.
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Your team factor</p>
          <p className="text-2xl font-semibold text-slate-700">Not applied this round</p>
          <p className="mt-2 text-sm text-slate-700">
            {view.raterCount === 0
              ? "No teammate submitted an evaluation for you this round, so there is nothing to work a factor out from."
              : "Only one teammate submitted an evaluation for you this round. A factor can be worked backwards to the rating behind it, so showing you one would tell you exactly what that single teammate said."}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            The team-scored part of your grade is left unchanged.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Your team factor</p>
          <p className={`text-4xl font-bold tabular-nums ${tone}`}>{view.factor.toFixed(2)}</p>

          <div className="mt-4" aria-hidden="true">
            {/* The range is deliberately asymmetric — losses run deeper than
                gains — so 1.00 is rarely the midpoint. Its label tracks its tick
                rather than sitting centred, which would misstate where an even
                share falls. */}
            <div className="relative mb-1 h-4 text-xs text-slate-500">
              <span
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${Math.min(94, Math.max(6, evenPercent))}%` }}
              >
                even share 1.00
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-200">
              <div className="absolute inset-y-0 w-px bg-slate-400" style={{ left: `${evenPercent}%` }} />
              <div
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow"
                style={{ left: `${gaugePercent(view.factor, floor, ceiling)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>lowest possible {floor.toFixed(2)}</span>
              <span>highest possible {ceiling.toFixed(2)}</span>
            </div>
          </div>

          <p className="mt-3 text-sm text-slate-700">{factorMeaning(view.factor)}</p>
          <p className="text-sm text-slate-600">{factorEffect(view.factor)}</p>
        </div>
      )}

      {!view.factorWithheld && (
      <div className="mt-4">
        <h3 className="mb-1 text-sm font-semibold">How this was worked out</h3>
        {detailed ? (
          <ul className="space-y-1 text-sm text-slate-700">
            <li>
              <span className="text-slate-500">Teammates who rated you:</span> {view.raterCount}
            </li>
            {share != null ? (
              <li>
                <span className="text-slate-500">Your average share, after the highest and lowest were dropped:</span>{" "}
                <strong className="tabular-nums">{share.toFixed(2)}</strong>{" "}
                <span className="text-slate-500">
                  (1.00 is an even split — {view.neutralShare.toFixed(1)} points per teammate)
                </span>
              </li>
            ) : (
              <li>
                <span className="text-slate-500">Your adjusted average was</span>{" "}
                <strong className="tabular-nums">{legacyPoints!.toFixed(1)}</strong>{" "}
                <span className="text-slate-500">
                  points, against {view.neutralShare.toFixed(1)} for an even split
                </span>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">
            {view.raterCount} of your teammates rated you. That is too few to show the figures behind the result
            without pointing to who said what, so they are left out.
          </p>
        )}
      </div>
      )}

      {scores.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">
            How your teammates rated you{" "}
            <span className="font-normal text-slate-500">— 1 never, 5 consistently</span>
          </h3>
          <div className="space-y-2">
            {scores.map((s, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-slate-700">{s.label}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                    {s.average.toFixed(1)}
                  </span>
                </div>
                <Meter value={s.average} />
              </div>
            ))}
          </div>
        </div>
      )}

      {view.note && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{view.note}</p>
      )}

      <p className="mt-4 text-xs text-slate-500">
        {view.factorWithheld
          ? "You are never shown who said what, and your teammates never see your results."
          : "These are averages across your teammates. You are never shown who said what, and your teammates never see your results."}
      </p>
    </Card>
  );
}

/** A 1–5 average as a proportion of the scale, with the whole points ticked. */
function Meter({ value }: { value: number }) {
  return (
    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div
        className="h-full rounded-full bg-indigo-500"
        style={{ width: `${Math.max(0, Math.min(100, (value / 5) * 100))}%` }}
      />
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${n * 20}%` }} />
      ))}
    </div>
  );
}
