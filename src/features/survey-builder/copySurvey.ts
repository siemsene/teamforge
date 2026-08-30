// Copying a survey from one of the instructor's other sessions.
//
// Questions and constraints move together on purpose: a constraint names the
// question it works on by id, so carrying one across without the other leaves a
// dangling reference that the readiness check has to block on. What can't come
// across cleanly is reported rather than dropped in silence — an instructor who
// asked for last term's setup should not have to notice for themselves that two
// of its constraints never arrived.

import { randomId } from "../../lib/util";
import type { Constraint, Question } from "../../types";

export interface CopySource {
  questions: Question[];
  constraints: Constraint[];
}

export interface CopyTarget {
  questions: Question[];
  constraints: Constraint[];
}

export interface SkippedItem {
  /** What was left behind, in the instructor's own words where possible. */
  label: string;
  reason: string;
}

export interface CopyPlan {
  /** Questions to append to the target, with fresh ids. */
  questions: Question[];
  /** Constraints to append, with fresh ids and remapped question references. */
  constraints: Constraint[];
  skipped: SkippedItem[];
}

/** Short names for the violations panel and the skip list. */
const CONSTRAINT_LABEL: Record<Constraint["kind"], string> = {
  projectRequirements: "Project requirements",
  antiIsolation: "Anti-isolation",
  balanceNumeric: "Numeric balance",
  minCapability: "Capability coverage",
  minCategory: "Category coverage",
  alignCategory: "Alignment",
  projectPreference: "Project preferences",
  teammatePreference: "Teammate preferences",
};

/**
 * Constraints that mean the same thing however many of them there are, so a
 * second copy would only double the penalty it contributes to the objective.
 */
const SINGLETON_KINDS: ReadonlySet<Constraint["kind"]> = new Set([
  "projectRequirements",
  "projectPreference",
  "teammatePreference",
]);

/**
 * Works out what would be added to `target` by copying `source`, without
 * writing anything.
 *
 * `newId` is injectable so tests can assert on the remapping rather than on
 * random strings.
 */
export function planSurveyCopy(
  source: CopySource,
  target: CopyTarget,
  newId: () => string = () => randomId(8),
): CopyPlan {
  const skipped: SkippedItem[] = [];
  const questions: Question[] = [];
  /** Source question id -> the id it was copied under. */
  const idMap = new Map<string, string>();

  let hasTeammatesQuestion = target.questions.some((q) => q.kind === "teammates");

  for (const q of source.questions) {
    if (q.auto) {
      // Auto questions belong to the projects that generated them: syncAutoQuestions
      // rebuilds them from *this* session's requirements and would drop any that
      // arrived without a requirement behind them.
      skipped.push({
        label: q.prompt,
        reason: "generated from the other session's projects — this session builds its own",
      });
      continue;
    }
    if (q.kind === "teammates" && hasTeammatesQuestion) {
      skipped.push({ label: q.prompt, reason: "this session already has a preferred-teammates question" });
      continue;
    }
    if (q.kind === "teammates") hasTeammatesQuestion = true;
    // Fresh ids throughout. A question id is what an encrypted answer is keyed
    // by, so reusing the source's would make two sessions' answers look alike,
    // and copying twice would collide with the first copy.
    const id = newId();
    idMap.set(q.id, id);
    questions.push({ ...q, id });
  }

  const hasRanking = target.questions.some((q) => q.kind === "projectRanking");
  const targetKinds = new Set(target.constraints.map((c) => c.kind));
  const constraints: Constraint[] = [];

  for (const c of source.constraints) {
    const skip = (reason: string) => skipped.push({ label: CONSTRAINT_LABEL[c.kind], reason });

    if (c.kind === "projectRequirements") {
      // Added and removed by the Projects tab, never by hand.
      skip("kept in step with this session's own project requirements");
      continue;
    }
    if (SINGLETON_KINDS.has(c.kind) && targetKinds.has(c.kind)) {
      skip("this session already has one");
      continue;
    }
    if (c.kind === "projectPreference" && !hasRanking) {
      skip("this session has no project-ranking question yet");
      continue;
    }
    if (c.kind === "teammatePreference" && !hasTeammatesQuestion) {
      skip("no preferred-teammates question to go with it");
      continue;
    }
    if ("questionId" in c) {
      const questionId = idMap.get(c.questionId);
      if (!questionId) {
        skip("the question it works on was not copied");
        continue;
      }
      constraints.push({ ...c, id: newId(), questionId });
      continue;
    }
    constraints.push({ ...c, id: newId() });
  }

  return { questions, constraints, skipped };
}
