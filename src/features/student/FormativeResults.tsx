import { useEffect, useState } from "react";
import { openEnvelope } from "../../lib/memberKey";
import type { AesEnvelope, EvalResultView } from "../../types";
import { Card, Spinner } from "../../components/ui";

const ROUND_LABEL: Record<string, string> = {
  formative: "practice round",
  summative: "graded round",
};

/** Renders a student's own published evaluation results. Per-share detail and
 * behavior averages appear only when at least three teammates rated them, so no
 * single rater's answer can be inferred. */
export function FormativeResults({ memberKey, envelope }: { memberKey: CryptoKey; envelope: AesEnvelope }) {
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
  return (
    <Card className="bg-emerald-50">
      <h2 className="mb-1 font-semibold">Your results — {ROUND_LABEL[view.round] ?? view.round}</h2>
      <p className="text-sm text-slate-700">
        Your team factor is <span className="font-bold">{view.factor.toFixed(2)}</span>. This is a private summary of
        how your teammates evaluated you.
      </p>
      {detailed ? (
        <ul className="mt-2 text-sm text-slate-700">
          <li>
            {share != null ? (
              <>
                An even split is 1.00. After dropping the highest and lowest rating you received, your average share
                was {share.toFixed(2)} — that is {view.neutralShare.toFixed(1)} points per teammate at an even split.
              </>
            ) : (
              <>
                Neutral (equal split) was {view.neutralShare.toFixed(1)} points; your adjusted average received share
                was {legacyPoints!.toFixed(1)}.
              </>
            )}
          </li>
          {view.behaviorAverages && view.behaviorAverages.length > 0 && (
            <li>
              Behavior averages: {view.behaviorAverages.map((a) => a.toFixed(1)).join(", ")} (out of 5).
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          Fewer than three teammates rated you, so only the overall factor is shown to protect their anonymity.
        </p>
      )}
      {view.note && <p className="mt-2 text-sm text-slate-600">{view.note}</p>}
    </Card>
  );
}
