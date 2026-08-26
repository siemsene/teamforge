// Regenerates the worked example published alongside the app, so students can
// check the arithmetic by hand against the same five-member team the
// instructor's spreadsheet uses.
//
//   npx vite-node scripts/worked-example.ts
//
// Run this whenever the default factor parameters change and paste the output
// into "Peer evaluation and team factor.xlsx" — the numbers here come from the
// same module the app uses, so the sheet cannot drift from the code.

import {
  DEFAULT_FACTOR_PARAMS as P,
  computeTeamFactors,
  neutralShare,
  type TeamEvalInput,
} from "../src/lib/teamFactor";
import { neutralRange } from "../src/lib/evalValidation";

const NAMES = ["Ana", "Ben", "Cara", "Dev", "Eli"];
const idx = (name: string) => NAMES.indexOf(name) + 1;

/** Five members, one free rider (Eli), one teammate who rates a little oddly. */
const BALLOTS: Record<string, Record<string, number>> = {
  Ana: { Ben: 28, Cara: 30, Dev: 27, Eli: 15 },
  Ben: { Ana: 30, Cara: 28, Dev: 27, Eli: 15 },
  Cara: { Ana: 30, Ben: 28, Dev: 27, Eli: 15 },
  Dev: { Ana: 30, Ben: 27, Cara: 28, Eli: 15 },
  Eli: { Ana: 35, Ben: 30, Cara: 20, Dev: 15 },
};

const team: TeamEvalInput = {
  teamLabel: "Team 1",
  memberCodeIndexes: NAMES.map((_, i) => i + 1),
  submissions: Object.entries(BALLOTS).map(([rater, points]) => ({
    round: "formative" as const,
    raterCodeIndex: idx(rater),
    teamLabel: "Team 1",
    points: Object.fromEntries(Object.entries(points).map(([n, v]) => [String(idx(n)), v])),
    justifications: {},
  })),
};

const nu = neutralShare(NAMES.length);
const band = neutralRange(NAMES.length - 1, P.deadband);
const result = computeTeamFactors(team, P);

const f = (n: number, d = 3) => n.toFixed(d);
console.log(`Even split (nu)      ${f(nu, 2)} points per teammate`);
console.log(`No-justification band ${band.low}-${band.high} points  (share 1 +/- ${P.deadband})`);
console.log(`Damping k = ${P.damping}   caps [${P.factorFloor}, ${P.factorCeiling}]\n`);

console.log("Points received (rows = ratee, columns = rater)");
console.log(["ratee".padEnd(6), ...NAMES.map((n) => n.padStart(6))].join(""));
for (const name of NAMES) {
  const cells = NAMES.map((rater) =>
    rater === name ? "—".padStart(6) : String(BALLOTS[rater][name]).padStart(6),
  );
  console.log([name.padEnd(6), ...cells].join(""));
}

console.log("\nShares (points / even split), then trim, mean, and factor");
console.log(
  ["member".padEnd(7), "shares".padEnd(30), "dropped".padEnd(16), "mean r".padEnd(9), "factor"].join(""),
);
for (const m of result.members) {
  const name = NAMES[m.codeIndex - 1];
  const shares = m.receivedShares.map((s) => f(s.share, 2)).sort().join(" ");
  const dropped =
    m.trimmedLow != null && m.trimmedHigh != null ? `${f(m.trimmedLow, 2)} ${f(m.trimmedHigh, 2)}` : "—";
  console.log(
    [name.padEnd(7), shares.padEnd(30), dropped.padEnd(16), f(m.share, 4).padEnd(9), f(m.factor, 4)].join(""),
  );
}

console.log(`\nTeam mean ${f(result.teamMean, 4)}   spread ${f(result.spread, 4)}${result.spreadFlagged ? " (flagged)" : ""}`);
for (const m of result.members) {
  if (m.flags.length) console.log(`  ${NAMES[m.codeIndex - 1]}: ${m.flags.join(", ")}`);
}
