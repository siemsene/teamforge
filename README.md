# TeamForge

Privacy-preserving student team allocation. Instructors build a survey, students answer anonymously via login codes, and a mixed-integer program (HiGHS, running as WebAssembly **in the instructor's browser**) assigns students to teams/projects while minimizing weighted constraint violations.

## Privacy model

- **Anonymous students.** The instructor generates N random login codes; only SHA-256 hashes are stored. The instructor privately keeps the code→name mapping (a CSV downloaded once at session creation) and emails codes to students. The platform never sees names or emails of students.
- **End-to-end encryption.** Survey answers are encrypted in the student's browser with the session's public key (ECDH P-256 + AES-256-GCM). The private key is stored only in passphrase-wrapped form — the database administrator cannot read responses. Decryption and team optimization happen exclusively in the instructor's browser; the saved allocation is encrypted too.
- **Key recovery.** A recovery key file is offered at session creation. Losing both the passphrase and recovery key makes the data permanently unreadable — by design.
- **Right to erasure.** One click purges all student records and allocations of a session (Privacy & data tab).
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
4. Adds constraints (anti-isolation, capability coverage, balance, preferences) with priorities.
5. Opens the session and emails each student the survey link + their code (template provided).
6. Students submit; the dashboard shows completion by code number.
7. Instructor closes the session, unlocks with the passphrase, runs the optimizer, drags students between teams with live violation feedback, exports the final CSV, and purges student data.
