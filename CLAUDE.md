# CLAUDE.md — project context for Claude Code

This file is read automatically by Claude Code. It tells a coding session what
this project is, how it's structured, and what to build next.

## What this is

**ARGUS** — a real-time world-events & conflict monitor. This repo is the
**backend + a live globe frontend**: it ingests real, free, geolocated conflict
data from **GDELT**, normalizes it into a unified event model, stores it, and
serves it over a small HTTP API that the frontend (and a larger command-center
UI) consume.

Focus is **world events and conflict** — natural disasters are an optional
secondary layer, deliberately deprioritized.

## Run / dev

- `npm run dev` — start with auto-reload (`node --watch src/server.js`), http://localhost:8787
- `npm start` — start without watch
- `npm run ingest` — run one ingest cycle standalone
- Requires **Node.js 18+**. **Zero dependencies** — keep it that way unless a
  dependency clearly earns its place.
- No API keys. GDELT is free and keyless.

## Architecture (the data flow)

```
GDELT GEO 2.0 + DOC 2.0  →  src/sources/gdelt.js  →  src/store.js  →  src/server.js  →  public/index.html
     (raw, free)             (fetch + normalize)      (dedupe/persist)   (HTTP API)        (live globe)
```

| File | Responsibility |
|---|---|
| `src/sources/gdelt.js` | GDELT adapter: builds queries, fetches GEO (map points) + DOC (wire), normalizes into records, falls back to `src/fixtures/*` when offline |
| `src/store.js` | Dedupe-by-id + JSON persistence. **This is the seam to swap for Postgres + PostGIS.** |
| `src/ingest.js` | Orchestrates fetch → normalize → store; runs on boot and every 15 min |
| `src/server.js` | HTTP API (`/api/health`, `/api/events`, `/api/wire`) + static host |
| `public/index.html` | Frontend: globe, hotspot list, conflict wire — consumes the API |
| `src/fixtures/` | Bundled sample data for offline/blocked-network runs |

## Unified event model

Every source normalizes into this shape (see `normalizeGeo` in `gdelt.js`):
`{ id, lat, lon, place, count, intensity, type, source, ingestedAt }`
`id` is a stable hash → re-ingesting the same item dedupes instead of piling up.

## Conventions

- ES modules (`"type": "module"`), Node built-ins only.
- Keep the store interface stable so `store.js` can be swapped for a real DB
  without touching the rest.
- The conflict query lives in `CONFLICT_QUERY` in `src/sources/gdelt.js`.
- API responses send `Access-Control-Allow-Origin: *` so external frontends
  (the full ARGUS command-center UI) can call them.

## Roadmap (what to build next — in order)

1. **Postgres + PostGIS** — replace `src/store.js`; add pgvector for dedupe.
2. **RSS sources** — add adapters (Al Jazeera, ReliefWeb, UN News, Crisis Group)
   behind the same normalizer, alongside GDELT.
3. **Dedupe/cluster** — embed `title + place + time`, merge duplicate reports.
4. **Instability index** — per-country score from event density + escalation.
5. **AI layer** — situation briefs + a cross-domain correlation engine.
6. **Realtime** — push updates over SSE instead of 60s polling.
7. **Commercial** — auth, Stripe, ACLED commercial feed, reliability/monitoring.

See the full build map (delivered separately) for detail on each phase.

## Notes / gotchas

- If it runs in **SAMPLE** mode with normal internet, something is blocking
  `api.gdeltproject.org` (firewall/egress). `/api/health` reports live vs sample.
- GDELT is machine-coded and noisy — expect the dedupe/cluster phase to matter.
- Verify data licensing before commercial launch (GDELT free; ACLED & premium
  OSINT require licenses).
