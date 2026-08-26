// Builds public/peer-eval-team-factor.xlsx — the worked example students are
// pointed at so they can check their own factor by hand.
//
//   npm run docs
//
// Every number below the ballots is a live formula, so the sheet is a working
// calculator rather than a picture of one: change a ballot, a parameter, or the
// team size and everything downstream follows. The formulas mirror
// src/lib/teamFactor.ts exactly; scripts/worked-example.ts prints the same
// figures straight from that module, and tests/teamFactor.test.ts pins them, so
// the three cannot drift apart.

import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "peer-eval-team-factor.xlsx");

const NAMES = ["Ana", "Ben", "Cara", "Dev", "Eli"];

/** Five members, one free rider (Eli), and one teammate who rates oddly in both
 * directions — Eli inflates Ana and marks Dev down. Both distortions get
 * trimmed away, which is the point of the example. */
const BALLOTS = {
  Ana: { Ben: 28, Cara: 30, Dev: 27, Eli: 15 },
  Ben: { Ana: 30, Cara: 28, Dev: 27, Eli: 15 },
  Cara: { Ana: 30, Ben: 28, Dev: 27, Eli: 15 },
  Dev: { Ana: 30, Ben: 27, Cara: 28, Eli: 15 },
  Eli: { Ana: 35, Ben: 30, Cara: 20, Dev: 15 },
};

// Row anchors. Members occupy five consecutive rows in each of the three blocks.
const POINTS_TOP = 16;
const SHARES_TOP = 26;
const CALC_TOP = 36;
const col = (i) => String.fromCharCode(66 + i); // 0 -> "B"

const INK = "FF1E293B";
const MUTED = "FF64748B";
const ACCENT = "FF0F766E";
const INPUT_FILL = "FFFFFBEB";
const DERIVED_FILL = "FFF8FAFC";
const RESULT_FILL = "FFECFDF5";
const BLOCKED_FILL = "FFE2E8F0";

const wb = new ExcelJS.Workbook();
wb.creator = "TeamForge";
wb.created = new Date(0); // deterministic output

const ws = wb.addWorksheet("Team factor", {
  views: [{ showGridLines: false }],
  properties: { defaultRowHeight: 16 },
});

ws.columns = [
  { width: 26 },
  ...NAMES.map(() => ({ width: 12 })),
  { width: 13 },
  { width: 42 },
  { width: 46 },
];

const title = (row, text) => {
  const c = ws.getCell(`A${row}`);
  c.value = text;
  c.font = { bold: true, size: 12, color: { argb: ACCENT } };
};

const note = (row, text) => {
  const c = ws.getCell(`A${row}`);
  c.value = text;
  c.font = { size: 9, color: { argb: MUTED } };
  ws.mergeCells(`A${row}:I${row}`);
  c.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 26;
};

const header = (row, labels) => {
  labels.forEach((label, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = label;
    c.font = { bold: true, size: 9, color: { argb: INK } };
    c.alignment = { horizontal: i === 0 ? "left" : "center", wrapText: true, vertical: "bottom" };
    c.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  ws.getRow(row).height = 28;
};

const fill = (cell, argb) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};

// ---------------------------------------------------------------- title ----

ws.getCell("A1").value = "Peer evaluation — how your team factor is worked out";
ws.getCell("A1").font = { bold: true, size: 16, color: { argb: INK } };
ws.mergeCells("A1:I1");

ws.getCell("A2").value =
  "Every figure below the ballots is a live formula. Change a ballot, a setting, or the team size and the rest follows — " +
  "so you can check your own result, or try a what-if.";
ws.getCell("A2").font = { size: 10, color: { argb: MUTED } };
ws.getCell("A2").alignment = { wrapText: true, vertical: "top" };
ws.mergeCells("A2:I2");
ws.getRow(2).height = 30;

// ------------------------------------------------------------- settings ----

title(4, "Settings your instructor chooses");

const SETTINGS = [
  ["Team size (n)", 5, "How many people are on the team.", "0"],
  ["Even split (ν)", { formula: "100/(B5-1)" }, "Points one teammate gives you when they split 100 evenly: 100 ÷ (n − 1).", "0.00"],
  ["Dead band (δ)", 0.08, "How far from an even split counts as noise. Inside this, your factor is exactly 1.00.", "0.00"],
  ["Damping (k)", 0.5, "How much of the deviation beyond the dead band actually carries through.", "0.00"],
  ["Lowest possible factor", 0.7, "The floor. Nobody can fall below this however harshly they are rated.", "0.00"],
  ["Highest possible factor", 1.05, "The ceiling. Deliberately closer to 1.00 than the floor is — see the second sheet.", "0.00"],
];

SETTINGS.forEach(([label, value, explain, fmt], i) => {
  const row = 5 + i;
  ws.getCell(`A${row}`).value = label;
  ws.getCell(`A${row}`).font = { size: 10 };
  const v = ws.getCell(`B${row}`);
  v.value = value;
  v.numFmt = fmt;
  v.alignment = { horizontal: "center" };
  v.font = { bold: true, size: 10 };
  fill(v, typeof value === "object" ? DERIVED_FILL : INPUT_FILL);
  v.border = { outline: { style: "thin", color: { argb: "FFCBD5E1" } } };
  const e = ws.getCell(`C${row}`);
  e.value = explain;
  e.font = { size: 9, color: { argb: MUTED } };
  e.alignment = { wrapText: true, vertical: "middle" };
  ws.mergeCells(`C${row}:I${row}`);
});

// ------------------------------------------------- step 1: the ballots -----

title(12, "Step 1 — what everyone allocated");
note(
  13,
  "Each row is one person's ballot: 100 points split across their four teammates, never themselves. Leave a whole row " +
    "blank to see what happens when somebody does not submit.",
);
header(15, ["Rater ↓  /  Ratee →", ...NAMES, "Total", "Status"]);

NAMES.forEach((rater, r) => {
  const row = POINTS_TOP + r;
  ws.getCell(`A${row}`).value = rater;
  ws.getCell(`A${row}`).font = { bold: true, size: 10 };

  NAMES.forEach((ratee, m) => {
    const c = ws.getCell(row, m + 2);
    if (rater === ratee) {
      c.value = "—";
      c.font = { color: { argb: "FFA0AEC0" } };
      fill(c, BLOCKED_FILL);
    } else {
      c.value = BALLOTS[rater][ratee];
      fill(c, INPUT_FILL);
    }
    c.numFmt = "0";
    c.alignment = { horizontal: "center" };
    c.border = { outline: { style: "thin", color: { argb: "FFE2E8F0" } } };
  });

  const total = ws.getCell(`G${row}`);
  total.value = { formula: `IF(COUNT(B${row}:F${row})=0,"",SUM(B${row}:F${row}))` };
  total.numFmt = "0";
  total.alignment = { horizontal: "center" };
  total.font = { bold: true };
  fill(total, DERIVED_FILL);

  const status = ws.getCell(`H${row}`);
  status.value = {
    formula:
      `IF(COUNT(B${row}:F${row})=0,"did not submit — counted as an even split",` +
      `IF(G${row}=100,"ok","must total 100"))`,
  };
  status.font = { size: 9, color: { argb: MUTED } };
});

// --------------------------------------------- step 2: points to shares ----

title(21, "Step 2 — turn points into shares");
note(
  22,
  "A share is the points you received divided by the even split (ν). 1.00 means exactly an even split, so the scale " +
    "reads the same whatever the team size. A teammate who did not submit leaves no share here — Step 3 counts them as " +
    "having split evenly, which is why skipping the form neither helps nor hurts anyone.",
);
header(24, ["Rater ↓  /  Ratee →", ...NAMES]);

NAMES.forEach((rater, r) => {
  const row = SHARES_TOP + r;
  const pRow = POINTS_TOP + r;
  ws.getCell(`A${row}`).value = rater;
  ws.getCell(`A${row}`).font = { bold: true, size: 10 };

  NAMES.forEach((ratee, m) => {
    const c = ws.getCell(row, m + 2);
    if (rater === ratee) {
      c.value = "—";
      c.font = { color: { argb: "FFA0AEC0" } };
      fill(c, BLOCKED_FILL);
    } else {
      c.value = {
        formula: `IF(COUNT($B${pRow}:$F${pRow})=0,"",${col(m)}${pRow}/$B$6)`,
      };
      fill(c, DERIVED_FILL);
    }
    c.numFmt = "0.00";
    c.alignment = { horizontal: "center" };
    c.border = { outline: { style: "thin", color: { argb: "FFE2E8F0" } } };
  });
});

// ------------------------------------- step 3: trim, average, map to f -----

title(31, "Step 3 — drop the extremes, average, then map to a factor");
note(
  32,
  "The highest and the lowest share you received are both thrown away, so neither a harsh teammate nor a generous one " +
    "decides your result on their own. That needs at least three real ratings; below that there is nothing safe to drop. " +
    "What is left is averaged into r, and r becomes your factor: " +
    "f = clip(1 + k × sign(d) × max(0, |d| − δ), floor, ceiling), where d = r − 1.",
);
header(35, [
  "Student",
  "Ratings received",
  "Assumed even",
  "Highest (dropped)",
  "Lowest (dropped)",
  "Average share r",
  "d = r − 1",
  "Factor",
  "Note",
]);

NAMES.forEach((name, m) => {
  const row = CALC_TOP + m;
  const sc = col(m); // this member's column in the shares block
  const range = `${sc}$${SHARES_TOP}:${sc}$${SHARES_TOP + NAMES.length - 1}`;

  ws.getCell(`A${row}`).value = name;
  ws.getCell(`A${row}`).font = { bold: true, size: 10 };

  const cells = [
    [`B${row}`, { formula: `COUNT(${range})` }, "0"],
    [`C${row}`, { formula: `$B$5-1-B${row}` }, "0"],
    [`D${row}`, { formula: `IF(B${row}>=3,MAX(${range}),"—")` }, "0.00"],
    [`E${row}`, { formula: `IF(B${row}>=3,MIN(${range}),"—")` }, "0.00"],
    [
      `F${row}`,
      {
        formula:
          `IF(B${row}>=3,(SUM(${range})+C${row}-D${row}-E${row})/($B$5-1-2),` +
          `(SUM(${range})+C${row})/($B$5-1))`,
      },
      "0.0000",
    ],
    [`G${row}`, { formula: `F${row}-1` }, "0.0000"],
  ];
  cells.forEach(([ref, value, numFmt]) => {
    const c = ws.getCell(ref);
    c.value = value;
    c.numFmt = numFmt;
    c.alignment = { horizontal: "center" };
    fill(c, DERIVED_FILL);
    c.border = { outline: { style: "thin", color: { argb: "FFE2E8F0" } } };
  });

  const f = ws.getCell(`H${row}`);
  f.value = {
    formula: `MIN($B$10,MAX($B$9,1+$B$8*SIGN(G${row})*MAX(0,ABS(G${row})-$B$7)))`,
  };
  f.numFmt = "0.00";
  f.alignment = { horizontal: "center" };
  f.font = { bold: true, size: 11 };
  fill(f, RESULT_FILL);
  f.border = { outline: { style: "thin", color: { argb: "FF6EE7B7" } } };

  const n = ws.getCell(`I${row}`);
  n.value = {
    formula:
      `IF(B${row}=0,"Nobody rated you, so your factor stays at 1.00",` +
      `IF(H${row}<0.9,"Your instructor will follow up before any grade is issued.",""))`,
  };
  n.font = { size: 9, color: { argb: MUTED } };
  n.alignment = { wrapText: true, vertical: "middle" };
});

const lastCalc = CALC_TOP + NAMES.length - 1;

ws.getCell(`A${lastCalc + 2}`).value = "Team mean";
ws.getCell(`A${lastCalc + 2}`).font = { bold: true, size: 10 };
const mean = ws.getCell(`H${lastCalc + 2}`);
mean.value = { formula: `AVERAGE(H${CALC_TOP}:H${lastCalc})` };
mean.numFmt = "0.000";
mean.alignment = { horizontal: "center" };
mean.font = { bold: true };
fill(mean, DERIVED_FILL);
ws.getCell(`I${lastCalc + 2}`).value =
  "Exactly 1.000 when a team has no real differences; below it only when somebody genuinely under-contributed.";
ws.getCell(`I${lastCalc + 2}`).font = { size: 9, color: { argb: MUTED } };
ws.getCell(`I${lastCalc + 2}`).alignment = { wrapText: true, vertical: "middle" };

ws.getCell(`A${lastCalc + 3}`).value = "Spread (highest − lowest)";
ws.getCell(`A${lastCalc + 3}`).font = { bold: true, size: 10 };
const spread = ws.getCell(`H${lastCalc + 3}`);
spread.value = { formula: `MAX(H${CALC_TOP}:H${lastCalc})-MIN(H${CALC_TOP}:H${lastCalc})` };
spread.numFmt = "0.000";
spread.alignment = { horizontal: "center" };
spread.font = { bold: true };
fill(spread, DERIVED_FILL);

ws.getCell(`A${lastCalc + 5}`).value = "Yellow cells are inputs you can change. Grey cells are calculated.";
ws.getCell(`A${lastCalc + 5}`).font = { size: 9, italic: true, color: { argb: MUTED } };
ws.mergeCells(`A${lastCalc + 5}:I${lastCalc + 5}`);

// ------------------------------------------------------ sheet 2: notes -----

const ws2 = wb.addWorksheet("How it works", { views: [{ showGridLines: false }] });
ws2.columns = [{ width: 30 }, { width: 96 }];

ws2.getCell("A1").value = "The rules behind the numbers";
ws2.getCell("A1").font = { bold: true, size: 16, color: { argb: INK } };
ws2.mergeCells("A1:B1");

const RULES = [
  [
    "An even split is the default",
    "It is also the neutral answer and a perfectly legitimate one. If everyone pulled their weight, say so — that is the " +
      "answer the form pre-fills, and you are done.",
  ],
  [
    "Small differences are ignored",
    "Anything within the dead band (δ) of an even split gives a factor of exactly 1.00. On a five-person team that is " +
      "23–27 points out of 25. This is why the unavoidable rounding when 100 will not divide evenly — 34/33/33 across " +
      "three teammates — never changes anyone's grade, and why you are only asked to justify an allocation that could " +
      "actually move someone's result.",
  ],
  [
    "The extremes are thrown away",
    "The highest and the lowest rating you receive are both dropped before averaging. One teammate cannot sink you, and " +
      "one teammate cannot carry you. It takes at least three real ratings to do this; on a very small team there is " +
      "nothing safe to drop.",
  ],
  [
    "A missing ballot is assumed even",
    "If a teammate never submits, they are counted as having split their 100 points evenly. Nobody gains from another " +
      "person's silence and nobody is penalised for it.",
  ],
  [
    "Gains are small, losses are not",
    "The ceiling sits much closer to 1.00 than the floor does, and only half of any deviation beyond the dead band " +
      "carries through. This is deliberate. It means a group cannot make itself better off by agreeing to mark one " +
      "person down: the target loses far more than the others could ever gain, so the arithmetic makes that cost the " +
      "team rather than pay it.",
  ],
  [
    "The team average is not forced to 1.00",
    "Because of the dead band and the caps, the factors are not a fixed pot being shared out. A team where everyone " +
      "contributed evenly averages exactly 1.00. A team carrying somebody who did not averages less, which is the " +
      "honest reading — nothing is rescaled behind the scenes to hide it.",
  ],
  [
    "A low factor is a conversation",
    "A factor below 0.90 is a flag for your instructor to follow up, not a grade. Nothing is decided by this arithmetic " +
      "on its own.",
  ],
  [
    "Your answers stay private",
    "Your teammates never see what you wrote. Only your instructor can read the ballots, and the summary returned to you " +
      "is yours alone.",
  ],
];

RULES.forEach(([heading, body], i) => {
  const row = 3 + i * 2;
  const h = ws2.getCell(`A${row}`);
  h.value = heading;
  h.font = { bold: true, size: 11, color: { argb: ACCENT } };
  h.alignment = { vertical: "top", wrapText: true };
  const b = ws2.getCell(`B${row}`);
  b.value = body;
  b.font = { size: 10, color: { argb: INK } };
  b.alignment = { wrapText: true, vertical: "top" };
  ws2.getRow(row).height = Math.max(30, Math.ceil(body.length / 105) * 15 + 15);
});

await wb.xlsx.writeFile(outPath);
console.log(`Wrote ${outPath}`);
