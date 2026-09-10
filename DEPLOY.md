# Deploying VIGIL to a test server

VIGIL is a **zero-dependency Node app** (Node 18+). One process:
`node src/server.js`, listening on `PORT` (default 8787). State is JSON files in
`data/`. No build step.

## Required environment variables
| var | needed? | notes |
|---|---|---|
| `AUTH_SECRET` | yes (prod) | signs session cookies. `openssl rand -hex 32`. If unset, a random one is generated per boot (logins drop on restart). |
| `ADMIN_PASSWORD` | recommended | seeds the `admin` account on first boot. If unset, a random password is printed to the logs. |
| `ANTHROPIC_API_KEY` | optional | enables the AI Analyst + AI briefs. |
| `PORT` | auto | set by the host; the app reads it. |
| `AUTH_REQUIRED` | optional | `false` to disable the login gate (not recommended). |

---

## Option A — Instant public URL (fastest, temporary)
Expose the server you already run locally, no deploy, no account:

```bash
# start VIGIL locally
AUTH_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=changeme node src/server.js
# in another terminal, tunnel it (pick one):
npx cloudflared tunnel --url http://localhost:8787      # prints a https://*.trycloudflare.com URL
# or:  ngrok http 8787
```
Good for a quick demo/share. The URL dies when you stop the tunnel.

## Option B — Render (persistent, no CLI) ← recommended for a test server
1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → select the repo (uses `render.yaml`).
3. Enter `ADMIN_PASSWORD` (and `ANTHROPIC_API_KEY` if you want the AI). Deploy.
4. Open the URL, log in as `admin`.
Free tier sleeps when idle; first hit after idle is slow. The mounted disk keeps
`data/` across deploys.

## Option C — Fly.io (CLI, global, cheap)
```bash
brew install flyctl && fly auth login
fly launch --no-deploy          # detects the Dockerfile
fly secrets set AUTH_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=changeme
# optional: fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

## Option D — Any VPS (DigitalOcean/EC2/Linode)
```bash
# on the server (Ubuntu):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
git clone <your-repo> vigil && cd vigil
printf 'AUTH_SECRET=%s\nADMIN_PASSWORD=changeme\n' "$(openssl rand -hex 32)" > .env
# run persistently:
sudo npm i -g pm2 && pm2 start src/server.js --name vigil && pm2 save
# put nginx + TLS (certbot) in front of PORT 8787 for https
```

## Docker (works on B/C/D)
```bash
docker build -t vigil .
docker run -p 8787:8787 -e AUTH_SECRET=$(openssl rand -hex 32) -e ADMIN_PASSWORD=changeme \
  -v $(pwd)/data:/app/data vigil
```

---

### Notes
- **Outbound network required** — VIGIL fetches ~150 live sources + GDELT/ADS-B/etc.
  A host that blocks egress will run in SAMPLE mode (`/api/health` shows `live`).
- **Ephemeral filesystems** (some PaaS) reset `data/` on redeploy → index history
  restarts. Use a mounted disk (Render blueprint does this) to persist it.
- **Boot ingest** takes ~30–60s across 150 sources; the app serves persisted data
  immediately and swaps in fresh data when the first ingest completes.
