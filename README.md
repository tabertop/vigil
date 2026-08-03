# ARGUS — Real-Time World-Events & Conflict Monitor (backend + live globe)

A **working, runnable** first model of the conflict monitor: it ingests real,
free, geolocated conflict data from **GDELT**, normalizes it into a unified
event model, stores it, serves it over a small HTTP API, and renders it on a
live globe. No API keys. No paid feeds. Zero npm dependencies.

This is Phase 0–1 of the build map made real.

---

## Run it (30 seconds)

Requires **Node.js 18+** (uses the built-in `fetch`).

```bash
cd argus-server
node src/server.js
```

Then open **http://localhost:8787**

That's it — no `npm install` needed (the project has no dependencies).

### Dev mode (auto-reload)

```bash
npm run dev      # = node --watch src/server.js
```

The server restarts automatically whenever you edit a file — edit
`public/index.html` (frontend) or anything in `src/` (backend) and just refresh
the browser. This is your live dev-test loop.

Change the port with `PORT=3000 node src/server.js`.

### What you'll see
- On a machine with normal internet, the top-right pill reads **LIVE · GDELT**
  and the globe shows wherever conflict news is concentrated *right now*.
- With no network (or behind a strict firewall), it transparently falls back to
  a **bundled sample** so it always runs — the pill reads *SAMPLE DATA*.

> Note: some sandboxes block outbound traffic to `api.gdeltproject.org`. If you
> see SAMPLE mode on a normal connection, check your network/egress rules.

---

## What it does

```
GDELT (GEO 2.0 + DOC 2.0)          real, free, no key
        │
        ▼
  src/sources/gdelt.js   ← fetch + normalize into unified records
        │
        ▼
  src/store.js           ← dedupe by stable id, persist to data/*.json
        │
        ▼
  src/server.js          ← HTTP API + serves the frontend
        │
        ▼
  public/index.html      ← live globe, hotspot list, conflict wire
```

Ingestion runs **once on boot and every 15 minutes** thereafter (matching
GDELT's update cadence).

### API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | ingest status (live vs sample, counts, last run) |
| `GET /api/events` | GeoJSON `FeatureCollection` of geolocated conflict signals |
| `GET /api/wire`   | latest conflict news articles (title, url, domain, time) |

Both data endpoints send `Access-Control-Allow-Origin: *`, so the existing
ARGUS command-center frontend can call them cross-origin — swap its demo proxy
fetches for `http://localhost:8787/api/events` and `/api/wire`.

---

## The two GDELT sources (why both)

- **GEO 2.0** (`/api/v2/geo/geo`) returns *where* conflict news is
  concentrated — geolocated points with mention counts. This drives the map.
- **DOC 2.0** (`/api/v2/doc/doc`) returns *what* is being reported — the
  article list. This drives the wire.

The conflict query lives in `src/sources/gdelt.js` (`CONFLICT_QUERY`) — edit it
to widen/narrow coverage (e.g. add `OR protest OR coup`).

---

## Files

```
argus-server/
├── package.json
├── README.md
├── src/
│   ├── server.js          HTTP API + static host + ingest timer
│   ├── ingest.js          fetch → normalize → store (also runnable standalone)
│   ├── store.js           dedupe + persistence (swap for Postgres in prod)
│   ├── sources/
│   │   └── gdelt.js        GDELT GEO + DOC adapter, normalizers, fallback
│   └── fixtures/          bundled sample data (offline fallback)
└── public/
    └── index.html         live globe frontend that consumes the API
```

---

## Going to production (the next steps from the build map)

This model deliberately keeps things dependency-free. To harden it:

1. **Storage** → replace `src/store.js` with **Postgres + PostGIS** (geo
   queries) and **pgvector** (dedupe embeddings). The rest of the app is
   written against the same functions, so only this file changes.
2. **Dedupe/cluster** → embed `title + place + time` and merge near-duplicate
   reports into one event with multiple sources (Phase 2).
3. **More sources** → add RSS adapters (Al Jazeera, ReliefWeb, UN News, Crisis
   Group) and ACLED (paid, precise) behind the same normalizer. GDELT stays the
   free backbone.
4. **Instability index** → compute per-country scores from event density +
   escalation (Phase 2).
5. **AI layer** → situation briefs + correlation engine over the stored events
   (Phase 3).
6. **Realtime** → push updates to the frontend over SSE instead of 60s polling.
7. **Deploy** → frontend on Vercel/Cloudflare; this server on Railway/Fly/Render;
   Postgres on Supabase/Neon.

---

*Working name ARGUS. GDELT data is free; verify terms before commercial launch.
ACLED and premium OSINT require licenses (see the build map).*
