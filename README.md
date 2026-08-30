# TeamForge

Privacy-preserving student team allocation. Instructors build a survey, students answer anonymously via login codes, and a mixed-integer program (HiGHS, running as WebAssembly **in the instructor's browser**) assigns students to teams/projects while minimizing weighted constraint violations.

## Privacy model

- **Anonymous students.** The instructor generates N random login codes; only SHA-256 hashes are stored. The instructor privately keeps the code→name mapping (a CSV downloaded once at session creation) and emails codes to students. The platform never receives names or emails of students — including in the optional team-management phase, where display names are chosen by students themselves and stored only as ciphertext.
- **End-to-end encryption.** Survey answers are encrypted in the student's browser with the session's public key (ECDH P-256 + AES-256-GCM). The private key is stored only in passphrase-wrapped form — the database administrator cannot read responses. Decryption and team optimization happen exclusively in the instructor's browser; the saved allocation is encrypted too.
- **Key recovery.** A recovery key file is offered at session creation. Losing both the passphrase and recovery key makes the data permanently unreadable — by design.
- **Right to erasure.** One click purges all student records and allocations of a session (Privacy & data tab). A purge that cannot delete something says so rather than reporting success.
- No analytics, no tracking, no third-party scripts. The only outbound third-party request is an optional admin-notification email on **instructor** registration (Web3Forms); student-facing pages talk only to Firebase.

### Threat model (what the encryption does and doesn't guarantee)

Encryption protects student responses against anyone who can read the **stored data** — including the platform/database operator inspecting Firestore, or a database breach. The decryption key (passphrase / recovery key) is never sent to the server; the private key is stored only in wrapped form.

As with all browser-delivered encryption, the guarantee assumes the **served application code is honest**: an operator who tampers with the deployed frontend could capture answers in the student's browser before they are encrypted, or capture an instructor's passphrase. Mitigate by deploying from reviewed, pinned builds to hosting you and your instructors trust. This is why the in-app copy is scoped to "the server stores only ciphertext / the key is never sent to the server" rather than an absolute "nobody can ever read responses."

## Stack

React + TypeScript + Vite + Tailwind · Firebase Spark tier (Auth, Firestore, Hosting — $0, no Cloud Functions) · [highs-js](https://github.com/lovasoa/highs-js) MIP solver in a Web Worker · WebCrypto.

## Setup

1. **Create a Firebase project** (free Spark plan) at console.firebase.google.com:
   - Enable **Authentication** → sign-in methods **Email/Password** and **Anonymous**.
   - Create a **Firestore** database (production mode).
   - Register a **Web app** and copy its config.
2. `cp .env.example .env.local` and fill in the Firebase config values.
3. `npm install`
4. Put your Firebase project id into `.firebaserc`.
5. Deploy rules + app:
   ```sh
   npm run build
   npx firebase-tools deploy
   ```
6. Sign up in the app with your own email, find your UID under Authentication → Users, then:
   - set it as `VITE_ADMIN_UID` in `.env.local` (and rebuild/redeploy),
   - paste it into `adminUid()` in `firestore.rules` and `npx firebase-tools deploy --only firestore:rules`,
   - approve your own account from `/admin` (or set `approved: true` on your `users/{uid}` doc in the console once).

### Local development

```sh
npx firebase-tools emulators:start   # auth + firestore emulators
# in another terminal, with VITE_USE_EMULATORS=true in .env.local:
npm run dev
```

`highs` must stay in `optimizeDeps.include` in [`vite.config.ts`](vite.config.ts). It is published as CommonJS with bare `node:` imports and is loaded only from inside a module Web Worker, so excluding it from pre-bundling leaves the dev server handing that raw file to the worker, which cannot parse it — every solve then fails with an empty "Solver crashed" and the whole allocation step is untestable locally. Production builds are unaffected either way, which is what makes this easy to reintroduce without noticing.

### Tests

```sh
npm test   # crypto round-trips, login codes, MIP solver correctness & scale
npm run lint   # TypeScript-only static check
npm run test:rules   # Firestore security rules against the emulator
```

### Guides (PDF)

Two generated PDFs live in `public/`:

- `instructor-guide.pdf` — full handbook, linked from the header, dashboard, and awaiting-approval screen.
- `student-guide.pdf` — one-page quick guide, linked from the survey login screen.

Regenerate both after changing the workflow or their content:

```sh
npm run docs   # runs scripts/generate-{instructor,student}-guide.mjs
```

## How a session works

1. Instructor registers (email verification + manual admin approval).
2. Creates a session: student count, team sizes, passphrase → downloads the one-time **login codes CSV** and **recovery key**.
3. Defines projects with requirements (e.g. "needs ≥1 CS major") — matching survey questions are generated automatically; adds custom numeric/categorical/teammate-preference questions.
4. Adds constraints (anti-isolation, category/capability coverage, alignment, balance, preferences) with priorities.
5. Opens the session and emails each student the survey link + their code (template provided).
6. Students submit; the dashboard shows completion by code number. Enrollment churn in the first weeks is handled on the **Roster** tab: add students who joined late (their codes are shown once, as at creation, to append to the master CSV) or remove students who dropped. Code indexes are retired, never reused, because the index is what names a student inside every encrypted payload. Anything already derived from the roster — a saved allocation, provisioned teams — says it is out of date rather than being quietly wrong.
7. Instructor closes the session, unlocks with the passphrase, runs the optimizer, drags students between teams with live violation feedback, exports the final CSV, and purges student data.

## Team management (optional)

After allocation, an instructor may enable a **Team management** phase on the same session to run team contracts and peer evaluations. It is entirely optional — allocation-only sessions are unaffected.

- **Roster.** On the **Teams** tab, the instructor uploads the login-codes CSV **unchanged** — no `team` column to add. (If students were added later, that means the master CSV with the appended rows: a file covering only part of the class deletes every team it does not mention, and the import asks before doing so.) Team assignments are read from the saved allocation (`results/allocation`, keyed by the same `SHA-256(code)` the CSV rows hash to), so nothing is re-entered; a `team` column is still honoured and overrides the allocation per row, for teams adjusted by hand or sessions that skipped the optimizer. The upload exists only because login codes are shown once and never stored, and each student's team is sealed under a key derived from their own code — so the code must come from the instructor, while the teams need not. **No names are uploaded**: a `name` column, if present, is shown in the on-screen preview so the instructor can confirm the file and is then discarded in the browser. The browser encrypts each student's team membership under a key derived from that student's own login code, so the platform never stores team membership in plaintext either. Contract text and an encrypted team directory are written the same way.
- **Display names.** On first login a student chooses their own display name, sealed under their team key so only teammates and the instructor can read it. Students are told they may use their real name or any nickname, as long as they tell their teammates which one they picked. Until a student chooses, they show as their code index (`#7`); nothing is blocked, since the code index — not the name — is what the factor calculation uses. Instructor tables and CSV exports pair the display name with the code index, so the instructor can join back to their own codes CSV for grading. The platform never holds that mapping.
- **Contracts.** Students log in with the same code and land on a hub. The instructor can read a contract from the first save onward — drafts included — and the student-facing copy says so. Any team member drafts the team's contract (communications, attendance, timeliness, respect, effort, integrity, plus custom sections), optionally requests AI feedback, and finalizes it. Contracts are encrypted for the team and shared with the instructor; every member can save the finalized contract as a PDF (the button opens the browser's print dialog, with the file pre-named for the course and team — printing rather than bundling a PDF library is what keeps non-Latin text intact). The instructor reads all contracts on the Teams tab after unlocking.
- **Peer evaluations.** Two rounds — a **practice** (formative) round whose results are returned privately, and a **graded** (summative) round. Submitted ballots are re-validated after decryption on the instructor's Peer evals tab: the payload is encrypted, so the security rules can only check its envelope, and a hand-crafted one that breaks the 100-point rule is excluded there and reported rather than scored. An excluded rater imputes as an even split, exactly like a teammate who never submitted. The form: allocate 100 points across teammates (an equal split is the default; anything far enough from it to move a factor needs one sentence of justification), four 1–5 behavior ratings, and an optional confidential comment. The instructor opens/closes each round, sees completion by code number, and after unlocking computes team factors, reviews flags (factor < 0.90, team spread > 0.20, or a member everyone rated the same and low), exports summary and detail CSVs, and can publish each student's own factor back to them privately.
- **The team factor.** Computed in shares, where `1.00` is an even split — a share is the points received divided by `100 / (n - 1)`. A teammate who did not submit is imputed as having split evenly. The highest and lowest share received are dropped (needs ≥ 3 real raters; imputed shares are never dropped), the rest averaged to `r`, then mapped through a dead band with damping and deliberately asymmetric caps:

  ```
  d = r - 1
  f = clip(1 + k * sgn(d) * max(0, |d| - δ), floor, ceiling)      δ = 0.08, k = 0.5, floor = 0.70, ceiling = 1.05
  ```

  The guarantee is a statement about team size as well as caps: markers gain `(n − 1) × (ceiling − 1)` between them while the target loses `1 − floor`, so it holds while the former is smaller. At the defaults that is true up to a team of six and false from seven, which is why the settings panel works the sum through at *this session's* largest team and warns when the inequality fails. `scapegoatingIsNegativeSum` in `src/lib/teamFactor.ts` is the same arithmetic, pinned by tests.

  A live worked example of exactly this arithmetic ships at `public/peer-eval-team-factor.xlsx` (regenerated by `npm run docs`, pinned by `tests/teamFactor.test.ts`, and linked from both the instructor's Peer evals tab and the student peer-eval form). Every figure below the ballots is an Excel formula, so students can change an input and watch the result follow.

  The dead band means ordinary noise and integer rounding move nobody's grade. Trimming both ends neutralises a lone hostile rater *and* a lone generous one. The tight ceiling against the deep floor is what makes scapegoating negative-sum: four members dumping on a fifth gain 0.05 each while the target loses 0.30. The team mean is therefore not pinned to 1.00 — it lands there exactly when a team has no real dispersion, and falls below only when someone genuinely under-contributed. That is reported to the instructor, never silently corrected.

- **Roster changes after teams exist.** Removing a student deletes their document, so their login code stops working immediately — the survey, their team and the contract all become unreachable. It does **not** take back a team key they had already derived: team documents are reached by holding an unguessable token, and a bearer credential cannot be revoked after the fact. Someone who kept it can still read and edit that team's contract while team management is on. Re-uploading the roster with a **different label** for that team mints a fresh token and closes it, at the cost of starting that team's contract and display names over. Re-provisioning is what removes the departed member from their teammates' rosters and evaluation forms, so the Teams tab says so until you do it.
- **Ballots survive a departure.** A teammate who leaves mid-round would once have invalidated every ballot already submitted by that team — points allocated to a non-member, and a total no longer equal to 100 — so the team's real ratings were replaced by imputed even splits. Ballots are now validated against the roster they were *written* against and then reconciled to the survivors: the departed member's points are dropped and the rest scaled back up, preserving exactly what the rater said about everyone still there. The shares are kept exact rather than rounded back to whole points, because rounding a reconciled ballot amplifies the integer remainder already in it and can push a neutral rater's teammates outside the dead band. The instructor's detail CSV carries both what was submitted and what was scored.
- **Emails.** Editable, copyable drafts for each phase — the survey (Overview tab), teams and the contract (Teams tab), and one per peer-evaluation round (Peer evals tab). All share the `<STUDENT NAME>` / `<LOGIN CODE>` / `<DEADLINE>` placeholders so a single mail merge works throughout, and the graded-round draft is generated from the session's live settings, so the caps it quotes are the ones actually applied. Drafts are owner-only — `publicTeamMgmt` mirrors just round status, note and published-ness.

### AI contract feedback (optional)

AI feedback runs through a small **Cloudflare Worker** in [`worker/`](worker/) that holds the Anthropic API key as a secret — necessary because the app itself has no server. Deploy it (see [`worker/README.md`](worker/README.md)), then:

- set `VITE_AI_PROXY_URL` in `.env.local` to the worker URL,
- list every origin you serve the app from in the worker's `ALLOWED_ORIGINS` (a custom domain **and** the Firebase defaults — the browser sends whichever the student loaded, and the worker rejects the rest both in CORS headers and server-side). Be clear about what that check is worth: an `Origin` header is set by the caller, so it stops other websites' *browsers* and nothing else. The real control on API-key spend is `DAILY_CAP` (default 120), which is why it is set low rather than generously; the counters live in KV and are read-then-write, so a burst can overshoot a cap. And
- add that origin to the `connect-src` directive of the Content-Security-Policy in `firebase.json` (the default already allows `https://*.workers.dev`; change it if you use a custom domain), then rebuild and redeploy.

### A note on the Content-Security-Policy

`script-src` in [`firebase.json`](firebase.json) carries `'wasm-unsafe-eval'` alongside `'self'`. **Do not remove it**: CSP counts compiling WebAssembly as code generation, so without it the highs-js solver fails at `WebAssembly.instantiate` and team allocation cannot run at all on the deployed site. `'wasm-unsafe-eval'` permits WebAssembly and nothing else — `eval()` and `new Function()` still throw, verified in headless Chrome against the exact policy string. `'unsafe-eval'` would fix the same symptom by re-enabling JavaScript code generation everywhere; don't reach for it. [`tests/csp.test.ts`](tests/csp.test.ts) guards both halves of this. It requires Chrome 97+, Firefox 102+, or Safari 16.4+.

When `VITE_AI_PROXY_URL` is unset the AI-feedback button simply doesn't appear and everything else in team management still works. AI feedback is the one point where contract text (never names) leaves the app's end-to-end encryption; it is disclosed to students in the privacy note and gated behind an explicit consent dialog.

## License

© 2026 Enno Siemsen. Licensed under [Creative Commons Attribution-NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/) (CC BY-NC 4.0) — see [LICENSE](LICENSE).

You may share and adapt the material with attribution, **for non-commercial purposes**. For commercial use, contact the author.
