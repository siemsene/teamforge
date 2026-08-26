// Generates public/instructor-guide.pdf — the downloadable instructor handbook.
// Re-run after changing the guide content or the app's workflow:
//   npm run docs
//
// Pure Node + pdfkit (built-in Helvetica fonts, no external assets), so it runs
// anywhere without a browser or server.

import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { guardPdfText } from "./pdf-text-guard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "instructor-guide.pdf");
mkdirSync(join(root, "public"), { recursive: true });

const INK = "#0f172a";
const SUB = "#475569";
const ACCENT = "#4338ca";
const RULE = "#e2e8f0";
const BOXBG = "#eef2ff";
const BOXBORDER = "#c7d2fe";

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 64, bottom: 60, left: 64, right: 64 },
  bufferPages: true,
  info: {
    Title: "TeamForge — Instructor Guide",
    Author: "TeamForge",
    Subject: "How to run a privacy-preserving team allocation, end to end",
  },
});

// Fail loudly on any character the built-in fonts cannot encode.
guardPdfText(doc, "instructor-guide.pdf");
doc.pipe(createWriteStream(outPath));

const PAGE_W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const LEFT = doc.page.margins.left;

function space(n = 1) {
  doc.moveDown(n);
}
function h1(text) {
  if (doc.y > doc.page.margins.top) doc.addPage();
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(22).text(text);
  doc.moveTo(LEFT, doc.y + 4).lineTo(LEFT + PAGE_W, doc.y + 4).strokeColor(RULE).lineWidth(1).stroke();
  space(0.8);
  doc.fillColor(INK);
}
function h2(text) {
  space(0.6);
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(14).text(text);
  space(0.3);
  doc.fillColor(INK);
}
function h3(text) {
  space(0.3);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11.5).text(text);
  space(0.15);
}
function p(text) {
  doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(text, { align: "left", lineGap: 2 });
  space(0.35);
}
function bullets(items, { numbered = false } = {}) {
  doc.fillColor(INK).font("Helvetica").fontSize(10.5);
  doc.list(items, {
    bulletRadius: numbered ? undefined : 1.6,
    textIndent: 14,
    bulletIndent: 4,
    lineGap: 2,
    listType: numbered ? "numbered" : "bullet",
  });
  space(0.45);
}
function note(title, text) {
  const padding = 10;
  doc.font("Helvetica-Bold").fontSize(10.5);
  const titleH = doc.heightOfString(title, { width: PAGE_W - 2 * padding });
  doc.font("Helvetica").fontSize(10);
  const bodyH = doc.heightOfString(text, { width: PAGE_W - 2 * padding, lineGap: 2 });
  const boxH = titleH + bodyH + 2 * padding + 4;
  if (doc.y + boxH > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const top = doc.y;
  doc.roundedRect(LEFT, top, PAGE_W, boxH, 6).fillAndStroke(BOXBG, BOXBORDER);
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10.5).text(title, LEFT + padding, top + padding, {
    width: PAGE_W - 2 * padding,
  });
  doc.fillColor(INK).font("Helvetica").fontSize(10).text(text, LEFT + padding, top + padding + titleH + 4, {
    width: PAGE_W - 2 * padding,
    lineGap: 2,
  });
  doc.y = top + boxH;
  space(0.6);
}

// ----------------------------------------------------------------------------
// Cover
// ----------------------------------------------------------------------------
doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(34).text("TeamForge", { align: "left" });
doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text("Instructor Guide", { align: "left" });
space(0.5);
doc.fillColor(SUB).font("Helvetica").fontSize(11).text(
  "How to build a survey, collect anonymous responses, and let the optimizer form balanced student teams — privately, end to end.",
  { width: PAGE_W * 0.85, lineGap: 3 },
);
space(1.2);
doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("What TeamForge does");
space(0.2);
p(
  "TeamForge helps you sort a class into project teams while honoring rules you set — team sizes, skill balance, " +
    "diversity safeguards, project requirements, and student teammate preferences. Students answer a short survey " +
    "anonymously; a mixed-integer optimizer then proposes an assignment you can fine-tune by hand.",
);
note(
  "Privacy in one line",
  "Student answers are encrypted in the student's browser before upload, the decryption key never reaches the server, " +
    "and the optimizer runs inside your browser. The platform stores only ciphertext and never receives student names or emails.",
);
space(0.3);
doc.fillColor(SUB).font("Helvetica-Oblique").fontSize(9.5).text(
  "This guide follows one running example — “MGMT 4500, Spring 2027”, 30 students, six project teams — from sign-up to final roster.",
  { width: PAGE_W * 0.9, lineGap: 2 },
);

// ----------------------------------------------------------------------------
// 1. The big picture
// ----------------------------------------------------------------------------
h1("1. The big picture");
p("A session moves through these stages. You can revisit earlier stages until you open the survey.");
bullets(
  [
    "Register and get approved — sign up with your university email; an administrator approves your account.",
    "Create a session — set student count, team sizes, and an encryption passphrase. You download two files once.",
    "Define projects (optional) — describe each project and any attribute requirements (e.g. “needs >=1 CS major”).",
    "Build the survey — add demographic, skill, and preference questions, often from built-in standard scales.",
    "Set constraints — choose which rules matter and how strongly (Must / Important / Nice to have).",
    "Open the survey — students log in with a private code, see a share code, and submit encrypted answers.",
    "Close and allocate — unlock with your passphrase, run the optimizer, adjust teams, export the roster.",
    "Team management (optional) — keep the session going after allocation to run team contracts and two rounds of peer evaluations (see §11).",
    "Erase — purge student data once teams are final.",
  ],
  { numbered: true },
);
note(
  "Tabs you will use",
  "Inside a session: Overview (status, invite text, delete) · Projects · Survey · Constraints · Responses (completion) · " +
    "Allocation (optimize & export) · Privacy & data (erase). A “Projects” tab appears only for sessions with named projects; " +
    "“Teams” and “Peer evals” tabs appear once you enable the optional team-management phase (§11).",
);

// ----------------------------------------------------------------------------
// 2. Getting an account
// ----------------------------------------------------------------------------
h1("2. Getting an account");
bullets([
  "Click Register and enter your name, your university/institution, and your email. Please use your university email — it speeds up approval.",
  "Verify your email via the link sent to you, then reload.",
  "Your account then waits for manual approval by the site administrator. You cannot create sessions until approved.",
  "Once approved, sign in to reach My sessions (your dashboard).",
]);
note(
  "Why approval?",
  "Approval keeps the free service limited to legitimate instructors. The administrator only sees your name, " +
    "university, and email — never any student data.",
);

// ----------------------------------------------------------------------------
// 3. Creating a session  (example)
// ----------------------------------------------------------------------------
h1("3. Creating a session");
p('From My sessions, click New session. For our example we enter:');
bullets([
  "Title: “MGMT 4500 — Operations Strategy, Spring 2027”.",
  "Students: 30.",
  "Ideal team size: 5. Min and Max auto-fill to 4 and 6 (ideal ± 1); you can override them.",
  "Generic projects: left unchecked — we want six named projects, one team each. (Check it instead to just split the class into N teams with no project descriptions.)",
  "Encryption passphrase: a strong phrase of at least 10 characters, entered twice.",
]);
p("When you click Create, TeamForge generates the session and downloads two files. This is the only time you receive them.");
h3("File 1 — student codes (CSV)");
bullets([
  "One row per student with: studentIndex, loginCode, shareCode, surveyLink, and blank columns for the student's name and email.",
  "The loginCode is private to each student — it is their key to the survey and is never stored on the server (only a hash is).",
  "The shareCode is a short public code students use to name preferred teammates. It is safe to share and cannot be used to log in.",
  "Fill in the name/email columns yourself to keep your private mapping; this file never leaves your computer.",
]);
h3("File 2 — recovery key");
p(
  "A text file containing a recovery key that can unlock student data if you forget your passphrase. Store it somewhere " +
    "safe and separate from the codes.",
);
note(
  "Read this twice",
  "The passphrase and recovery key are the ONLY ways to decrypt student answers. If you lose both, the data is " +
    "permanently unreadable — by design, no one (including the platform operator) can recover it for you.",
);

// ----------------------------------------------------------------------------
// 4. Projects
// ----------------------------------------------------------------------------
h1("4. Defining projects");
p(
  "On the Projects tab, add each project with a name and a description students will see. Optionally add requirements — " +
    "attributes a team must contain.",
);
p("In our example we add six projects. For the “Data Dashboard” project we add a requirement:");
bullets([
  "Attribute: “Major”. Because Major is a recognized standard scale, the Required value becomes a dropdown — we pick “Computer Science” (choosing from the list avoids near-duplicate categories like “CS” vs “Computer Science”).",
  "Min count: 1 — the team needs at least one Computer Science major.",
]);
note(
  "Requirements wire themselves into the survey",
  "Each requirement automatically adds a matching question to the survey (e.g. a “What is your Major?” single-choice " +
    "question, pre-filled with the standard list of majors) and an umbrella “project requirements” constraint you can " +
    "weight on the Constraints tab. Edit the generated question's options freely afterward.",
);

// ----------------------------------------------------------------------------
// 5. Building the survey
// ----------------------------------------------------------------------------
h1("5. Building the survey");
p(
  "On the Survey tab, click Add question. The fastest path is Start from a standard scale, a dropdown of vetted " +
    "questions grouped into Demographics, Academic, Skills & ratings, and Work style. Selecting one fills in the type, " +
    "prompt, and options, which you can then edit.",
);
h3("Question types");
bullets([
  "Single choice / Multiple choice — categorical options, one per line. Used for demographics, major, roles, etc.",
  "Numeric scale — a 1–5 (or any range) rating. You can attach a word to each number (e.g. 1 = “No experience” … 5 = “Expert”). Numbers are what the optimizer balances; the words are shown to students for clarity.",
  "Preferred teammates — students enter the share codes of classmates they want to work with (see §7).",
]);
p("For MGMT 4500 we add, from the standard scales:");
bullets([
  "Gender (Demographics) — to keep teams from isolating a single student of one gender.",
  "Proficiency in spreadsheet modeling (Skills & ratings, numeric 1–5 with labels) — to balance skill across teams.",
  "Preferred teammates (Work style) — so friends can request each other.",
  "Plus the auto-generated “What is your Major?” question from the Data Dashboard requirement.",
]);
note(
  "No free-text answers — by design",
  "Students can only pick options or numbers; there is no place to type a name. This is one reason the platform never " +
    "learns who anyone is.",
);

// ----------------------------------------------------------------------------
// 6. Constraints
// ----------------------------------------------------------------------------
h1("6. Setting constraints");
p(
  "Constraints are the rules the optimizer trades off. Team-size limits are always enforced; everything else carries a " +
    "weight: Must hold, Important, or Nice to have. Higher weight = the optimizer works harder to satisfy it.",
);
h3("Constraints you add yourself");
bullets([
  "Anti-isolation — never put exactly one student with a given value (e.g. exactly one woman) on a team: each team gets zero or at least two. Great for our Gender question.",
  "Capability coverage — every team needs at least N students scoring >= a threshold on a numeric question (e.g. >=1 student rating spreadsheet skill >=4).",
  "Balance a numeric attribute — spread a numeric question's average evenly across teams (e.g. even spreadsheet skill).",
]);
h3("Constraints TeamForge manages or suggests for you");
bullets([
  "Project requirements (umbrella) — appears automatically when projects have requirements, tagged “from Projects”. Set how strongly to enforce it with its weight; edit the underlying requirements on the Projects tab.",
  "Suggested constraints — when your survey has a teammates or project-ranking question, a one-click suggestion appears to add “Respect teammate preferences” or “Respect project preferences”. Add it, then adjust its weight.",
]);
p(
  "For our example we set: project requirements = Must hold; anti-isolation on Gender = Important; balance spreadsheet " +
    "skill = Important; respect teammate preferences = Nice to have.",
);

// ----------------------------------------------------------------------------
// 7. Opening the survey & inviting students
// ----------------------------------------------------------------------------
h1("7. Opening the survey and inviting students");
bullets([
  "On the Overview tab, set the status to Open. (Draft = students can't submit yet; Closed = submissions locked.)",
  "Copy the survey link and the editable email template. Mail-merge a message to each student with their personal loginCode from the CSV.",
  "Edit and Save the email template per course; placeholders like <LOGIN CODE> are filled per student by your mail-merge.",
]);
h3("Login codes vs. share codes — keep them straight");
bullets([
  "Login code (private): each student's key to open and submit the survey. Never shared with classmates.",
  "Share code (public): shown to the student after they log in. They exchange these with friends and type them into the “preferred teammates” question. A share code cannot be used to log in, so sharing it is safe.",
]);
note(
  "What the student sees",
  "The student opens the link, reads a privacy notice, enters their login code, and (if a teammates question exists) " +
    "sees their own share code to pass to friends. Answers are encrypted in their browser on submit. They may edit or " +
    "withdraw their response any time while the survey is open.",
);

// ----------------------------------------------------------------------------
// 8. Tracking responses
// ----------------------------------------------------------------------------
h1("8. Tracking responses");
p(
  "The Responses tab shows completion by student index (never by name — the platform doesn't have names). Use it to see " +
    "who still needs a reminder. You cannot read individual answers here; they stay encrypted until you unlock them on " +
    "the Allocation tab.",
);

// ----------------------------------------------------------------------------
// 9. Allocating teams
// ----------------------------------------------------------------------------
h1("9. Closing and allocating teams");
bullets([
  "Set the session status to Closed so no further submissions arrive.",
  "Open the Allocation tab and unlock with your passphrase (or the recovery key). Decryption happens only in your browser.",
  "Optionally set a solver time limit (seconds), then click Run optimizer. The optimizer runs locally as WebAssembly.",
  "Review the proposed teams on the board. Each team shows which constraints it satisfies or violates.",
  "Drag students between teams to adjust by hand; violation feedback updates live.",
  "Click Save (encrypted) to store the allocation (encrypted), and Export CSV to download the final roster (team + student index).",
]);
note(
  "Large classes",
  "The model uses one variable per (student × team). Very large instances may not reach a proven optimum within the time " +
    "limit — raise the limit, accept a good-enough result, or use fewer teams. TeamForge warns you when a problem is large.",
);

// ----------------------------------------------------------------------------
// 10. Privacy & erasure
// ----------------------------------------------------------------------------
h1("10. Privacy, data, and erasure");
h3("What is guaranteed");
bullets([
  "Students are identified only by random codes; the platform never receives names or emails.",
  "Answers are encrypted in the student's browser; the server stores only ciphertext.",
  "The decryption key (passphrase / recovery key) is never sent to the server; only you can decrypt.",
  "Optimization runs in your browser; the saved allocation is encrypted too.",
  "No analytics, tracking, or third-party scripts on student pages.",
]);
h3("The honest caveat");
p(
  "Like all browser-delivered encryption, these guarantees assume the app's code is served honestly. An operator who " +
    "tampered with the deployed app could capture data before it is encrypted. The protections fully cover anyone " +
    "reading the stored database, which is the realistic threat.",
);
h3("Erasing data");
bullets([
  "Purge student data (Privacy & data tab) deletes all encrypted responses and the saved allocation, keeping the session shell.",
  "Delete session (Overview or Privacy & data tab) removes everything for the session.",
  "Good practice: purge once teams are final, and delete the private codes CSV from your computer at the end of term.",
]);

// ----------------------------------------------------------------------------
// 11. Team management (optional)
// ----------------------------------------------------------------------------
h1("11. Team management (optional)");
p(
  "After you close a session and allocate teams, you can optionally keep using it to run team contracts and peer " +
    "evaluations. This is entirely optional — if you only need team allocation, ignore this chapter. Enable it from " +
    "the Overview tab once the session is Closed; two new tabs appear, Teams and Peer evals.",
);
h3("Uploading the final roster");
bullets([
  "Take the login-codes CSV you downloaded when creating the session and add one column: team (any label, e.g. \"Team 1\" or a project name). Teams may differ from the optimizer's output if you adjusted them.",
  "You do not upload names. If your working sheet already has a name column, leave it — TeamForge shows those names in the on-screen preview so you can confirm you picked the right file, but they never leave your browser.",
  "On the Teams tab, upload that CSV. Your browser encrypts each student's team membership under a key derived from their own login code, so the platform never stores team membership in plaintext either.",
  "Students log in with the same code they used for the survey.",
]);

h3("Display names (students choose their own)");
bullets([
  "On first login a student is asked to choose a display name. It is encrypted under their team's key, so only their teammates and you can read it — the platform stores it unreadable.",
  "Students may use their real name, a short form, or any nickname; the app tells them to share their choice with their teammates so everyone knows who is who when evaluating.",
  "Until a student chooses one, they appear to teammates and to you as their code number (e.g. #7). Everything still works — the code index, not the name, is what the factor maths uses.",
  "Your review tables and CSV exports show the display name next to the code index. Because you hold the codes CSV, you can map a code index back to the real student for your gradebook; TeamForge itself never learns that mapping.",
]);
h3("Team contracts");
bullets([
  "Any one team member drafts the contract (communication, attendance, timeliness, respect, effort, integrity, plus custom sections). All members can view and edit it.",
  "Teams may optionally request AI feedback, revise, and finalize. Every member can save the finalized contract as a PDF.",
  "You can read every team's contract on the Teams tab after unlocking with your passphrase, and download them all.",
]);
h3("Peer evaluations");
bullets([
  "Two rounds: a practice (formative) round whose results you can return privately, and a graded (summative) round. Open and close each round on the Peer evals tab.",
  "The form is fixed: allocate 100 points across teammates (an equal split is the default and the neutral answer; any allocation far enough from it to actually move that teammate's factor needs a one-sentence justification — on a team of five that means anything outside 23–27), rate four behaviors 1–5 (required unless you untick “Include behavior ratings” in the Peer evals settings), and an optional confidential comment to you.",
  "Watch completion by code number, then unlock to compute each student's team factor. The factor multiplies the team-scored part of a grade. Everything is computed in shares, where 1.00 is an even split: your share of one ballot is the points you got divided by 100 ÷ (team size - 1). The highest and the lowest share you received are dropped, the rest averaged, and the result mapped through a dead band (delta), damping (k) and asymmetric caps — f = clip(1 + k * sign(d) * max(0, |d| - delta), floor, ceiling), where d is your average share minus 1. Defaults: delta = 0.08, k = 0.5, floor 0.70, ceiling 1.05.",
  "A teammate who does not submit is treated as having split evenly, so skipping the form neither helps them nor penalises everyone else.",
  "Two deliberate asymmetries. Dropping both the highest and the lowest share means one hostile rater and one over-generous rater are equally powerless. And the ceiling sits closer to 1.00 than the floor does, so a group that agrees to sink one member gains far less than the target loses — the arithmetic makes that play cost the team rather than pay it.",
  "Factors below 0.90, teams whose factors spread by more than 0.20, and members everyone rated the same and low are flagged for your attention before any grade is issued. Export summary and detail CSVs, and optionally publish each student's own factor back to them privately.",
  "A ready-made worked example ships with the app at /peer-eval-team-factor.xlsx — the same five-member team, as a live Excel calculator rather than a picture of one. Every figure below the ballots is a formula, so students can change a number and watch the result move. There is a download link on the Peer evals tab.",
  "The table shows a team mean. It reads exactly 1.00 for any team without real dispersion and dips below only when someone genuinely under-contributed — the dead band is what makes that true, and nothing rescales the numbers behind your back.",
]);
note(
  "AI feedback is optional and clearly bounded",
  "AI contract feedback runs through a small proxy you deploy (see worker/README.md). It is the one point where contract " +
    "text — never names — leaves the end-to-end encryption. If you don't configure it, the feature is simply hidden and " +
    "everything else works. Students see an explicit disclosure and must confirm before any text is sent.",
);

// ----------------------------------------------------------------------------
// 12. Troubleshooting
// ----------------------------------------------------------------------------
h1("12. Troubleshooting & FAQ");
const faq = [
  ["“Awaiting approval” after registering.", "Your email is verified but an administrator hasn't approved you yet. You can't create sessions until then."],
  ["I forgot my passphrase.", "Unlock with the recovery key file instead (Allocation tab). Then consider re-creating the session with a passphrase you'll remember."],
  ["I lost both the passphrase and recovery key.", "The student answers are permanently unreadable — by design. Re-open the survey with new codes if you must collect again."],
  ["A student says their code isn't recognized.", "Check for typos; codes are case-insensitive and tolerant of dashes/spaces. Make sure they're using their login code, not a share code, and that the survey is Open."],
  ["The same category appears twice (e.g. “Woman” and “Female”).", "Use the standard-scale dropdown for both the survey option and the project requirement value so they match exactly; remove the stray option from the survey question."],
  ["The optimizer won't finish / says the problem is large.", "Raise the time limit, reduce the number of teams, or relax some Must constraints to Important."],
  ["Nothing happens when I change something.", "TeamForge shows an inline error if a save fails (e.g. you're offline). Check your connection and try again."],
  ["The AI feedback button doesn't appear for teams.", "It only shows when the AI proxy is configured (VITE_AI_PROXY_URL) and \"Offer AI contract feedback\" is checked in the Peer evals settings. Without the proxy, contracts still work — just without AI feedback."],
  ["A peer-eval factor looks off.", "Check the Share column first: 1.00 is an even split, and anything within the dead band (±0.08 by default) maps to a factor of exactly 1.00. The highest and lowest share a student received are dropped before averaging, and the Trimmed column shows which two went. Export the detail CSV to see every allocation."],
  ["The team mean is below 1.00. Is that a bug?", "No. The dead band and the deliberately tight ceiling mean the factors are not a fixed pot being redistributed. A team where everyone contributed evenly averages exactly 1.00; a team carrying a free rider averages less, which is the honest reading. Nothing is rescaled to hide it."],
  ["A group could agree to give one member nothing and split the rest. What stops them?", "Less than you might fear, and the numbers say so plainly. Four members dumping on a fifth gain 0.05 each while the target loses 0.30, so the play costs the team more than it pays the plotters — and each of them must write a justification for every allocation involved. Watch for the “unanimous low” flag: independent raters sizing up a real free rider disagree with each other, while people working from an agreed number do not. Then read their justifications in the detail CSV; near-identical wording is the tell. Treat it as a prompt to talk to the team, never as proof."],
  ["A student shows as \"#7\" instead of a name.", "They haven't chosen a display name yet — it appears as soon as they log in and pick one. Nothing is blocked in the meantime: contracts and peer evaluations work, and the code index is what the factor calculation uses either way."],
  ["Two students picked confusingly similar display names.", "The app already refuses an exact duplicate within a team. For near-duplicates, ask one of them to change it (Change on their hub); tables and exports also show the code index so you can always tell them apart."],
  ["How do I get from a display name back to the real student?", "Use the code index shown beside it and your own login-codes CSV, where you kept the code-to-student mapping. That join happens in your spreadsheet — the platform never holds it."],
];
faq.forEach(([q, a]) => {
  h3(q);
  p(a);
});

// ----------------------------------------------------------------------------
// Footers with page numbers
// ----------------------------------------------------------------------------
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#94a3b8")
    .text(
      `TeamForge — Instructor Guide        Page ${i + 1} of ${range.count}`,
      LEFT,
      doc.page.height - 38,
      { width: PAGE_W, align: "center" },
    );
  doc.page.margins.bottom = bottom;
}

doc.end();
console.log(`Wrote ${outPath}`);
