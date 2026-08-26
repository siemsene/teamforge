// Generates public/student-guide.pdf — a one-page quick guide for students,
// linked from the survey page. Re-run after content changes:  npm run docs
//
// Pure Node + pdfkit (built-in fonts), no browser or server needed.

import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { guardPdfText } from "./pdf-text-guard.mjs";
import { pdfInfo } from "./deterministic.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.DOCS_OUT_DIR ?? join(root, "public");
const outPath = join(outDir, "student-guide.pdf");
mkdirSync(outDir, { recursive: true });

const INK = "#0f172a";
const SUB = "#475569";
const ACCENT = "#4338ca";
const RULE = "#e2e8f0";
const BOXBG = "#eef2ff";
const BOXBORDER = "#c7d2fe";

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 54, bottom: 48, left: 60, right: 60 },
  info: pdfInfo({
    Title: "TeamForge — Student Quick Guide",
    Author: "TeamForge",
    Subject: "How to take your team-formation survey, and how your privacy is protected",
  }),
});

// Fail loudly on any character the built-in fonts cannot encode.
guardPdfText(doc, "student-guide.pdf");
doc.pipe(createWriteStream(outPath));

const PAGE_W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const LEFT = doc.page.margins.left;

function space(n = 1) {
  doc.moveDown(n);
}
function h2(text) {
  space(0.45);
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(12.5).text(text);
  space(0.2);
  doc.fillColor(INK);
}
function p(text) {
  doc.fillColor(INK).font("Helvetica").fontSize(10).text(text, { lineGap: 1.5 });
  space(0.3);
}
function bullets(items, { numbered = false } = {}) {
  doc.fillColor(INK).font("Helvetica").fontSize(10);
  doc.list(items, {
    bulletRadius: numbered ? undefined : 1.5,
    textIndent: 13,
    bulletIndent: 3,
    lineGap: 1.5,
    listType: numbered ? "numbered" : "bullet",
  });
  space(0.35);
}
function note(title, text) {
  const padding = 9;
  doc.font("Helvetica-Bold").fontSize(10);
  const titleH = doc.heightOfString(title, { width: PAGE_W - 2 * padding });
  doc.font("Helvetica").fontSize(9.5);
  const bodyH = doc.heightOfString(text, { width: PAGE_W - 2 * padding, lineGap: 1.5 });
  const boxH = titleH + bodyH + 2 * padding + 3;
  const top = doc.y;
  doc.roundedRect(LEFT, top, PAGE_W, boxH, 6).fillAndStroke(BOXBG, BOXBORDER);
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10).text(title, LEFT + padding, top + padding, {
    width: PAGE_W - 2 * padding,
  });
  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(text, LEFT + padding, top + padding + titleH + 3, {
    width: PAGE_W - 2 * padding,
    lineGap: 1.5,
  });
  doc.y = top + boxH;
  space(0.45);
}

// ---- header ----
doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(26).text("TeamForge");
doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text("Student quick guide");
space(0.3);
doc.fillColor(SUB).font("Helvetica").fontSize(10).text(
  "Your instructor is using TeamForge to form project teams. You'll answer a short, anonymous survey. Here's everything you need.",
  { width: PAGE_W, lineGap: 1.5 },
);
doc.moveTo(LEFT, doc.y + 5).lineTo(LEFT + PAGE_W, doc.y + 5).strokeColor(RULE).lineWidth(1).stroke();
space(0.7);

// ---- your two codes ----
h2("Your two codes — keep them straight");
bullets([
  "Login code (private): this is your key to open and submit the survey. It looks like ABC12-DE345. Never share it — anyone with it could answer as you.",
  "Share code (public): a short code (e.g. 7QF2) shown to you after you log in. Give it to classmates you'd like on your team. It cannot be used to log in, so it's safe to share.",
]);

// ---- taking the survey ----
h2("Taking the survey");
bullets(
  [
    "Open the survey link your instructor sent you.",
    "Enter your login code and continue. (Codes ignore case, spaces, and dashes.)",
    "Answer the questions and submit. Your answers are encrypted in your browser before they're sent.",
    "Need to change something? Return with your login code any time while the survey is open to edit or withdraw your response.",
  ],
  { numbered: true },
);

// ---- teammates ----
h2("Asking to be with specific classmates");
p(
  "If the survey has a “preferred teammates” question, swap share codes with the friends you'd like to work with and " +
    "type their share codes into that question. The optimizer tries to honor these, but can't promise every request — " +
    "team sizes and other rules come first.",
);

// ---- privacy ----
h2("How your privacy is protected");
bullets([
  "You're identified only by your random code — the platform never receives your name or email.",
  "Your answers are encrypted in your browser; the server only ever stores unreadable ciphertext.",
  "The decryption key is never sent to the server — only your instructor can read responses.",
  "Your instructor can permanently erase all survey data once teams are formed.",
]);

note(
  "Trouble logging in?",
  "Double-check for typos and make sure you're using your login code (not a share code). If it still isn't recognized, " +
    "the survey may not be open yet, or your code may be mistyped — ask your instructor.",
);

// ---- team management (optional phase) ----
h2("After teams are formed (if your instructor uses it)");
p(
  "Some instructors keep using TeamForge to manage teams during the term. Log in with the same login code to reach " +
    "your team hub, where you can see your teammates' names, write a team contract, and complete peer evaluations.",
);
bullets([
  "Team contract: any member can draft your team's norms (communication, attendance, effort, and so on). You can ask for AI feedback, revise together, then finalize it. “Save as PDF” opens your browser's print dialog — choose Save as PDF as the destination, not a printer; the file is already named for your course and team. If you request AI feedback, only the contract text is sent for suggestions — don't type anyone's full name into it.",
  "Peer evaluations: you'll allocate 100 points across your teammates, rate a few behaviors, and optionally leave a private note to your instructor. There's a practice round first, then a graded one. Your teammates never see your answers.",
  "An equal split is the default and a perfectly legitimate answer — if everyone pulled their weight, say so and you're done. Small differences are treated as noise: the form shows you the range that changes nobody's grade, and anything inside it needs no explanation. Going outside that range does change someone's grade, so it asks you for one sentence saying why.",
  "You can check the arithmetic yourself. The peer-evaluation page links a spreadsheet that works through a five-person team step by step — it is a live calculator, so you can change the numbers and see what would happen. Nothing about how your factor is worked out is hidden from you.",
  "Two things worth knowing. The highest and the lowest rating you receive are both thrown away before your factor is worked out, so no single teammate — generous or harsh — decides your result. And if a teammate never submits, they're counted as having split evenly, so nobody gains or loses from someone else's silence.",
]);
note(
  "Your privacy still holds here",
  "Your name and team are encrypted with a key derived from your own login code, your peer evaluations are readable " +
    "only by your instructor, and results returned to you are encrypted so only you can open them.",
);

doc.end();
console.log(`Wrote ${outPath}`);
