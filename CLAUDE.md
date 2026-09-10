# CLAUDE.md — project context for Claude Code

This file is read automatically by Claude Code. It tells a coding session what
this project is, how it's structured, and what to build next.

## What this is

**VIGIL** — a real-time world-events & conflict monitor. This repo is the
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
GDELT GEO+DOC ─┐
RSS/Atom feeds ┤→ src/sources/*  →  src/analysis/instability.js  →  src/store.js  →  src/server.js  →  public/index.html
   (raw, free)     (normalize)        (fuse → per-country score)     (dedupe/persist)  (HTTP API)       (globe + index)
```

| File | Responsibility |
|---|---|
| `src/sources/gdelt.js` | GDELT adapter: GEO (precise map points) + DOC (wire), normalizes, falls back to `src/fixtures/*` when offline |
| `src/sources/rss.js` | RSS/Atom multi-feed adapter (8 feeds: ReliefWeb, UN News, Crisis Group, Al Jazeera, BBC World, France 24, Deutsche Welle, Guardian World): parse → country-tag → wire records + coarse country signals; per-feed fixture fallback |
| `src/data/countries.js` | Country gazetteer + `tagCountries(text)` free-text matcher (shared by RSS + the index) |
| `src/analysis/instability.js` | Aggregates fused events → per-country instability score/tier |
| `src/analysis/dossier.js` | On click: builds a per-country/place intelligence dossier (risk drivers, confidence, key locations, feed, narrative) from stored events+wire+index |
| `src/store.js` | Dedupe-by-id + JSON persistence (events, wire, index). **This is the seam to swap for Postgres + PostGIS.** |
| `src/ingest.js` | Orchestrates fetch-all → fuse → score → store; runs on boot and every 15 min |
| `src/server.js` | HTTP API (`/api/health`, `/api/events`, `/api/wire`, `/api/index`, `/api/dossier`, `/api/topnews`, `/api/natural`, `/api/reference`) + static host. Data endpoints accept `?window=1h..7d\|all` and filter/re-aggregate by timestamp |
| `src/analysis/topnews.js` | Clusters the wire across outlets into ranked top stories (breadth + recency + severity) |
| `public/index.html` | Frontend: **3D globe (drag-to-rotate) / 2D map** (filled continents from `land.js`), **time filter**, **layers panel** (+ chokepoints), instability board, hotspots, LIVE FEEDS chips, wire, click-to-open **dossier** — consumes the API |
| `public/land.js` | Baked-in simplified world coastlines (Natural Earth 110m, public domain) for both views |
| `src/fixtures/` | Bundled sample data for offline/blocked-network runs (GDELT geo/doc + `rss.json`) |

## Unified event model

Every source normalizes into this shape:
`{ id, lat, lon, place, count, intensity, type, source, precise, ingestedAt }`
`id` is a stable hash → re-ingesting the same item dedupes instead of piling up.
`precise` is `true` for GDELT incident points and `false` for RSS country-centroid
signals (the frontend renders the latter as hollow rings). Wire records add
`{ title, url, domain, country, countries[], publishedAt, source }`.

## Conventions

- ES modules (`"type": "module"`), Node built-ins only.
- Keep the store interface stable so `store.js` can be swapped for a real DB
  without touching the rest.
- The conflict query lives in `CONFLICT_QUERY` in `src/sources/gdelt.js`.
- API responses send `Access-Control-Allow-Origin: *` so external frontends
  (the full VIGIL command-center UI) can call them.

## Roadmap (what to build next — in order)

- ✅ **RSS sources** — `src/sources/rss.js` (ReliefWeb, UN News, Al Jazeera)
  behind the same normalizer, alongside GDELT.
- ✅ **Instability index** — `src/analysis/instability.js`, per-country score.
1. **Postgres + PostGIS** — replace `src/store.js`; add pgvector for dedupe.
2. **Dedupe/cluster** — embed `title + place + time`, merge duplicate reports
   across sources into one event with multiple citations.
3. **Index trend** — persist index history so scores show escalation, not level.
4. **AI layer** — situation briefs + a cross-domain correlation engine.
5. **Realtime** — push updates over SSE instead of 60s polling.
6. **Commercial** — auth, Stripe, ACLED commercial feed, reliability/monitoring.

See the full build map (delivered separately) for detail on each phase.

## Notes / gotchas

- If it runs in **SAMPLE** mode with normal internet, something is blocking
  `api.gdeltproject.org` (firewall/egress). `/api/health` reports live vs sample.
- GDELT is machine-coded and noisy — expect the dedupe/cluster phase to matter.
- Verify data licensing before commercial launch (GDELT free; ACLED & premium
  OSINT require licenses).
