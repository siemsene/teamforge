// Ready-to-send emails for the team-management phase, so students hear the
// same thing the app enforces.
//
// The survey already had one of these (OverviewTab). These cover the two later
// moments — writing the contract, and each peer-evaluation round — because
// that is where students most need to know the rules in advance: an equal
// split is the neutral answer, small differences change nothing, the extremes
// they receive are thrown away, and a missing teammate costs nobody anything.
//
// Placeholders match the survey template's convention (<STUDENT NAME>,
// <LOGIN CODE>, <DEADLINE>) so the same mail merge works throughout.
//
// Pure module — the caller supplies live config, so an instructor who changes
// the factor caps sees the new numbers in the draft.

import type { EvalRoundId } from "../../types";

export interface EmailContext {
  title: string;
  /** Where students log in — the same URL they used for the survey. */
  link: string;
  /** Public URL of the worked-example workbook. */
  workbookUrl: string;
  factorFloor: number;
  factorCeiling: number;
  includeBehaviors: boolean;
  aiFeedbackEnabled: boolean;
  contractSections: string[];
}

const list = (items: string[]) => items.map((s) => `- ${s}`).join("\n");

export function contractEmail(ctx: EmailContext): string {
  return `Subject: ${ctx.title} — your team and your team contract

Dear <STUDENT NAME>,

Your project team is now set. Before the work starts, your team writes a short contract: how you will communicate, what you expect of each other, and what happens if something slips.

1. Open: ${ctx.link}
2. Enter your personal login code: <LOGIN CODE>
3. Choose a display name — this is what your teammates and I will see. Use your real name or a nickname, but tell your team which one you picked so everyone knows who is who.

Then, together as a team:

${list(ctx.contractSections.map((s) => s))}

Any one of you can start the draft and everyone can edit it${
    ctx.aiFeedbackEnabled ? ", and you can ask for AI feedback on a draft before you finalize it" : ""
  }. When you are happy with it, finalize it — each of you can then save a PDF copy.

Please finalize your contract by <DEADLINE>.

A contract is only useful if it is honest. Agree on things you will actually do, not things that sound good. You will be asked later how well the team lived up to it.

Keep your login code private — it is how the system knows you, and anyone with it could act as you.`;
}

export function peerEvalEmail(round: EvalRoundId, ctx: EmailContext): string {
  const practice = round === "formative";
  const behaviors = ctx.includeBehaviors
    ? "\n- Rate each teammate 1-5 on a few specific behaviours.\n"
    : "\n";

  const stakes = practice
    ? `This is the practice round. It does not affect anyone's grade. The point is to find out early how your team is actually working, while there is still time to fix it — and to see how the evaluation works before it counts.`
    : `This round counts. Your team factor is worked out from it and multiplies the team-scored part of your grade.`;

  const howItWorks = practice
    ? `You will get your own result back privately afterwards — your own figures only, never anyone else's.`
    : `How your factor is worked out, briefly:

- An even split is 1.00. Your factor moves only if your average is meaningfully away from that.
- The highest and the lowest rating you receive are both thrown away first, so no single teammate — generous or harsh — decides your result.
- Small differences are treated as noise and change nothing.
- The result is capped: it cannot fall below ${ctx.factorFloor.toFixed(2)} or rise above ${ctx.factorCeiling.toFixed(2)}.
- If a teammate does not submit, they are counted as having split evenly, so nobody gains or loses from someone else's silence.

You can check the arithmetic yourself — this spreadsheet works through a full example and recalculates as you change it: ${ctx.workbookUrl}`;

  return `Subject: ${ctx.title} — peer evaluation${practice ? " (practice round)" : ""}

Dear <STUDENT NAME>,

The ${practice ? "practice" : "graded"} peer evaluation for your project team is now open.

1. Open: ${ctx.link}
2. Enter your personal login code: <LOGIN CODE>

What you will be asked to do:

- Split 100 points across your teammates — not yourself. An equal split is the default and a perfectly good answer: if everyone pulled their weight, say so and you are done.
- The form shows you the range that counts as an even split. Staying inside it changes nobody's result. Going outside it does, so it asks you for one sentence explaining why.${behaviors}- Optionally leave a private note to me. Your teammates never see it.

${stakes}

${howItWorks}

Your teammates never see what you wrote — not your points, not your reasons. Only I can read them.

Please complete it by <DEADLINE>.

Two things worth saying plainly. Rating everyone identically because it feels safer is itself a choice, and it hides a teammate who is struggling or coasting. And agreeing with each other beforehand on what to submit is not teamwork — it is misconduct, it is visible in the data, and it will be treated as such.`;
}

/** Builds the interpolation context from live session + config. */
export function emailContext(
  title: string,
  link: string,
  config: {
    factorFloor: number;
    factorCeiling: number;
    includeBehaviors: boolean;
    aiFeedbackEnabled: boolean;
  },
  contractSections: string[],
): EmailContext {
  return {
    title,
    link,
    workbookUrl: `${new URL(link).origin}/peer-eval-team-factor.xlsx`,
    factorFloor: config.factorFloor,
    factorCeiling: config.factorCeiling,
    includeBehaviors: config.includeBehaviors,
    aiFeedbackEnabled: config.aiFeedbackEnabled,
    contractSections,
  };
}
