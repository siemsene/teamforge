# TeamForge

Privacy-preserving student team allocation. Instructors build a survey, students answer anonymously via login codes, and a mixed-integer program (HiGHS, running as WebAssembly **in the instructor's browser**) assigns students to teams/projects while minimizing weighted constraint violations.

## Privacy model

- **Anonymous students.** The instructor generates N random login codes; only SHA-256 hashes are stored. The instructor privately keeps the code→name mapping (a CSV downloaded once at session creation) and emails codes to students. The platform never sees names or emails of students.
- **End-to-end encryption.** Survey answers are encrypted in the student's browser with the session's public key (ECDH P-256 + AES-256-GCM). The private key is stored only in passphrase-wrapped form — the database administrator cannot read responses. Decryption and team optimization happen exclusively in the instructor's browser; the saved allocation is encrypted too.
- **Key recovery.** A recovery key file is offered at session creation. Losing both the passphrase and recovery key makes the data permanently unreadable — by design.
- **Right to erasure.** One click purges all student records and allocations of a session (Privacy & data tab).
- No analytics, no tracking, no third-party scripts.

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
```

## How a session works

1. Instructor registers (email verification + manual admin approval).
2. Creates a session: student count, team sizes, passphrase → downloads the one-time **login codes CSV** and **recovery key**.
3. Defines projects with requirements (e.g. "needs ≥1 CS major") — matching survey questions are generated automatically; adds custom numeric/categorical/teammate-preference questions.
4. Adds constraints (anti-isolation, capability coverage, balance, preferences) with priorities.
5. Opens the session and emails each student the survey link + their code (template provided).
6. Students submit; the dashboard shows completion by code number.
7. Instructor closes the session, unlocks with the passphrase, runs the optimizer, drags students between teams with live violation feedback, exports the final CSV, and purges student data.
