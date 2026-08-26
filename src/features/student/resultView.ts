// Turning a published evaluation result into something a student can read.
//
// The stored view carries bare numbers — a factor, a share, an array of
// behaviour averages. On its own an array of averages is unreadable: nothing
// says which number belongs to which behaviour. These helpers pair them back
// up and put the factor on a scale, so the card can show what each figure
// means rather than just what it is.
//
// Pure module — unit-testable without crypto or Firestore.

export interface BehaviourScore {
  label: string;
  average: number;
}

/**
 * Pairs behaviour averages with their labels.
 *
 * Labels are stored alongside the averages at publish time, because an
 * instructor who edits the behaviour list afterwards would otherwise silently
 * re-label results already sent out. Older results predate that, so the live
 * config is the fallback, and a positional placeholder the last resort — a
 * number with the wrong label is worse than a number with no label.
 */
export function behaviourScores(
  averages: number[] | undefined,
  storedLabels: string[] | undefined,
  configLabels: string[],
): BehaviourScore[] {
  if (!averages || averages.length === 0) return [];
  const labels = storedLabels?.length === averages.length ? storedLabels : configLabels;
  return averages.map((average, i) => ({
    label: labels[i] ?? `Behaviour ${i + 1}`,
    average,
  }));
}

/** Where a factor sits within its permitted range, as a 0-100 percentage. */
export function gaugePercent(factor: number, floor: number, ceiling: number): number {
  if (!(ceiling > floor)) return 50;
  const pct = ((factor - floor) / (ceiling - floor)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** One plain sentence on what this factor says, without editorialising. */
export function factorMeaning(factor: number): string {
  if (factor === 1) {
    return "An even share: your teammates' ratings put your contribution right at the team average.";
  }
  if (factor > 1) {
    return "Above an even share: your teammates rated your contribution above the team average.";
  }
  return "Below an even share: your teammates rated your contribution below the team average.";
}

/** How the factor is applied, in the student's own terms. */
export function factorEffect(factor: number): string {
  if (factor === 1) return "It leaves the team-scored part of your grade unchanged.";
  const pct = Math.round(Math.abs(factor - 1) * 1000) / 10;
  return factor > 1
    ? `It raises the team-scored part of your grade by ${pct}%.`
    : `It lowers the team-scored part of your grade by ${pct}%.`;
}
