# Telegram Folder Merger — MTProto Worker

This is the part that actually talks to Telegram as **your user account**.
It cannot run on the website's serverless backend, because Telegram's MTProto
protocol needs a long-lived process and a persistent connection.

It is tiny (one Node process, ~50 MB RAM) and free/cheap to host.

## What it does

- Holds your authorized Telegram user session (encrypted at rest).
- Runs your Telegram bot (long polling — no public webhook required).
- Reads `t.me/addlist/...` folder links, deduplicates by Telegram chat ID,
  checks real access, creates one new master folder, and exports the
  shareable link.
- Stores everything through the website's API. It never receives your
  database credentials.

## Deploy

### Railway (easiest)

1. Push this `worker/` folder to a GitHub repo.
2. railway.app → New Project → Deploy from GitHub repo → pick it.
3. Settings → Root Directory: `worker` (skip if the repo root *is* this folder).
4. Variables → add the four variables below.
5. Settings → Networking → **Generate Domain**. Copy that https URL.
6. Paste the URL into the website's Setup page, Step 1.

Build Command: `npm install --omit=dev`
Start Command: `node src/index.js`

Both are already declared in `worker/railway.json` and `worker/nixpacks.toml`,
so Railway picks them up automatically when Root Directory is `worker`.
If you leave Root Directory empty (repo root), the root `railway.json` applies
instead and runs `cd worker && node src/index.js`.

There is **no** `dist/` build output — this worker is plain Node.js and is
never bundled. Any start command pointing at `dist/server/server.js` is wrong.

The website itself is hosted by Lovable and must **not** be deployed to
Railway; Railway runs only this worker process.

### Fly.io

```bash
cd worker
fly launch --no-deploy
fly secrets set APP_URL=... WORKER_TOKEN=... ENCRYPTION_KEY=...
fly deploy
```

### Any VPS

```bash
cd worker
npm install
APP_URL=... WORKER_TOKEN=... ENCRYPTION_KEY=... node src/index.js
```

Put it behind HTTPS (Caddy/Nginx) so the website can reach it.

## Environment variables

| Variable | Where to get it |
| --- | --- |
| `APP_URL` | Shown on the website's Setup page (Step 1) |
| `WORKER_TOKEN` | Shown on the website's Setup page (Step 1) |
| `ENCRYPTION_KEY` | Generate yourself: `openssl rand -hex 32` |
| `PORT` | Optional, defaults to `8080` |

`ENCRYPTION_KEY` encrypts your Telegram API hash, bot token and user session
before they are stored. Keep it. If you lose it you must reconnect Telegram.

## Security notes

- Your API hash, bot token and Telegram session are AES-256-GCM encrypted by
  this worker before they leave it. The website stores only ciphertext.
- OTP codes and your 2FA password are used in memory only and never stored,
  never logged, and never sent to the bot.
- The `/rpc` endpoint requires the `WORKER_TOKEN` bearer.
- The bot only obeys the Telegram account that authorized the session.