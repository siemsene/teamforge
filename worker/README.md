# TeamForge AI feedback worker

A tiny Cloudflare Worker that holds the Anthropic API key and relays team-contract
feedback requests from the TeamForge app. It exists because TeamForge runs on the
Firebase Spark tier (no server), so there is nowhere else to keep the key secret.

The worker:

- accepts `POST /v1/feedback` with `{ sections: [{ id, title, text }], teamSize? }`,
- validates and rate-limits (per-IP hourly + global daily, via Workers KV),
- calls Claude with a fixed coaching system prompt and a JSON-schema structured
  output, and returns `{ overall, sections: [{ id, strengths, risks, suggestions }] }`,
- allows only your app's origins (CORS) and never logs request bodies.

No names or identifiers are sent — the app instructs teams not to include names,
and this is the one point where contract text leaves the app's end-to-end
encryption. AI feedback is optional per session.

## Deploy

Requires a Cloudflare account and `wrangler` (installed as a dev dependency here).

```sh
cd worker
npm install

# 1. Create the KV namespace for rate-limit counters and copy the id into wrangler.toml
npx wrangler kv namespace create RATE_KV

# 2. Store the Anthropic API key as a secret (never in the repo).
#    Use a dedicated key with a spend limit set in the Anthropic console.
npx wrangler secret put ANTHROPIC_API_KEY

# 3. Set ALLOWED_ORIGINS in wrangler.toml to every origin you serve the app
#    from (comma-separated), then deploy.
npx wrangler deploy
```

`wrangler deploy` prints the worker URL (e.g. `https://teamforge-ai.<account>.workers.dev`).

## Wire it into the app

1. Put the worker URL in the app's `.env.local`:

   ```
   VITE_AI_PROXY_URL=https://teamforge-ai.<account>.workers.dev
   ```

2. Add the worker's own origin to the app's Content-Security-Policy `connect-src` in
   `firebase.json`, then rebuild and redeploy the app.

3. In a session's **Peer evals → settings**, keep "Offer AI contract feedback"
   checked. If `VITE_AI_PROXY_URL` is unset, the AI feedback button never appears
   and everything else in team management still works.

## Configuration (wrangler.toml `[vars]`)

| Var             | Default            | Meaning                                  |
| --------------- | ------------------ | ---------------------------------------- |
| `ALLOWED_ORIGINS`| —                 | Comma-separated origins allowed to call it (CORS + server-side). `ALLOWED_ORIGIN` singular still works. |
| `MODEL`         | `claude-sonnet-5`  | Claude model used for feedback           |
| `HOURLY_PER_IP` | `10`               | Max requests per IP per hour             |
| `DAILY_CAP`     | `500`              | Global max requests per day              |

## Local development

```sh
npx wrangler dev   # serves on http://localhost:8787
npm test           # runs the pure validation / rate-limit unit tests
```

## If the app gets a CORS error

```
Response to preflight request doesn't pass access control check: The
'Access-Control-Allow-Origin' header has a value 'https://…' that is not
equal to the supplied origin.
```

The browser sends whichever host the student actually loaded, and one
deployment usually answers to several: a custom domain plus the Firebase
defaults (`*.web.app`, `*.firebaseapp.com`). Every one you serve from must be
listed in `ALLOWED_ORIGINS`, or requests from the others are rejected — the
worker enforces the same list server-side, so this is not merely a browser
formality. Add the missing origin and redeploy the worker; the app itself does
not need rebuilding.
