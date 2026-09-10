# VIGIL — Real-Time Global Instability Monitor (backend + live globe)

A **working, runnable** model of the intelligence monitor: it ingests real,
free, geolocated conflict data from **GDELT** *and* keyless **RSS/Atom news
feeds** (ReliefWeb, UN News, Al Jazeera), normalizes them into one unified event
model, fuses them, computes a **per-country instability index**, serves it all
over a small HTTP API, and renders it on a live globe. No API keys. No paid
feeds. Zero npm dependencies.

This is Phase 0–1 of the build map plus the **multi-source ingestion (step 2)**
and **instability index (step 4)** phases made real.

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
GDELT (GEO 2.0 + DOC 2.0) ─┐   real, free, no key
                           │
RSS/Atom feeds ────────────┤   ReliefWeb · UN News · Al Jazeera (keyless)
 src/sources/rss.js        │
                           ▼
  src/sources/*.js   ← fetch + normalize into one unified record shape
                           │
                           ▼
  src/analysis/instability.js  ← fuse events → per-country risk score (0–100)
                           │
                           ▼
  src/store.js       ← dedupe by stable id, persist to data/*.json
                           │
                           ▼
  src/server.js      ← HTTP API + serves the frontend
                           │
                           ▼
  public/index.html  ← live globe, instability index, hotspots, conflict wire
```

Ingestion runs **once on boot and every 15 minutes** thereafter (matching
GDELT's update cadence). Each source falls back independently to a bundled
sample if its network is blocked, so the app always runs — even partially
online (e.g. RSS live while GDELT is firewalled).

### API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | ingest status: `live`, active `sources[]`, counts, last run |
| `GET /api/events` | GeoJSON `FeatureCollection` of geolocated signals (`precise` flag distinguishes GDELT points from RSS country signals) |
| `GET /api/wire`   | latest news articles from all sources (title, url, domain, source, time) |
| `GET /api/index`  | per-country **instability index** — score, tier, contributing sources |
| `GET /api/dossier?iso=SD` (or `?place=…`) | drill-in **intelligence dossier**: risk score/tier, confidence, **instability sub-scores** (Unrest/Conflict/Military/Humanitarian), mined risk drivers, key locations, filtered feed, narrative assessment |
| `GET /api/topnews` | **aggregated top stories** — wire headlines clustered across outlets, ranked by source breadth + recency + severity |
| `GET /api/natural` | live USGS earthquakes (`natural` layer), window-filterable |
| `GET /api/reference` | static strategic layers: nuclear sites, military bases, spaceports, trade routes |

`/api/events`, `/api/wire`, `/api/index`, and `/api/dossier` all accept
`?window=1h|6h|24h|48h|7d|all` (default `24h`) and filter/re-aggregate by real
event timestamps server-side.

All data endpoints send `Access-Control-Allow-Origin: *`, so the existing
VIGIL command-center frontend can call them cross-origin — swap its demo proxy
fetches for `http://localhost:8787/api/events`, `/api/wire`, `/api/index`, and
`/api/dossier`.

## The frontend (command center)

`public/index.html` is a zero-dependency canvas UI:
- **3D globe / 2D map toggle** — both render real continents from a baked-in,
  simplified Natural Earth coastline (`public/land.js`, offline). The globe holds
  a fixed orientation with orbital rings + graticule and is **drag-to-rotate**
  freely (any direction); clicking a country glides it to center. Land and ocean
  are kept at matched luminance so rotating never swings the colour.
- **Time-range filter** (1h / 6h / 24h / 48h / 7d / All) — re-queries the API
  with `?window=` so the whole view (map, index, wire, dossier) re-aggregates by
  real timestamps server-side.
- **Layers panel** — a grouped, extensible layer registry: Conflict signals,
  Country signals, live **Seismic (USGS)**, **Nuclear sites**, **Military bases**,
  **Spaceports**, **Chokepoints**, and **Trade routes**. Each renders its own
  glyph on globe + map; add a layer by dropping a row into the `LAYERS` registry.
- **Index / Top News / Hotspots** tabs and a **LIVE FEEDS** chip row on the left.
  **Top News** clusters headlines across all outlets and ranks stories by how many
  sources cover them (breadth = importance). **Conflict wire** ticker along the
  bottom — all multi-source attributed.
- **Click any country, hotspot, map signal, or chokepoint** → a slide-in
  **intelligence dossier** (backed by `/api/dossier`) with the risk assessment,
  driver breakdown, key locations, and relevant reporting. The globe/map also
  spins/marks the selected location.

---

## The sources (why each)

**GDELT** (`src/sources/gdelt.js`):
- **GEO 2.0** returns *where* conflict news is concentrated — precise
  geolocated points with mention counts. Drives the map.
- **DOC 2.0** returns *what* is being reported — the article list. Drives the
  wire. The conflict query lives in `CONFLICT_QUERY` — edit it to widen/narrow
  coverage (e.g. add `OR protest OR coup`).

**RSS/Atom feeds** (`src/sources/rss.js`): 18 keyless humanitarian + wire feeds
across regions — ReliefWeb, UN News, Crisis Group, Al Jazeera, BBC World, France
24, Deutsche Welle, Guardian World, NPR, CBC, The Moscow Times, The Diplomat,
SCMP, Channel News Asia, Jerusalem Post, Anadolu, AllAfrica, Bellingcat. Each is
fetched independently and falls back on its own, so one blocked feed never sinks
the rest.

**USGS** (`src/sources/usgs.js`): live, keyless earthquake feed (M2.5+, past week)
powering the `natural` map layer, with a bundled fixture fallback. Each article is tagged to a country via
the gazetteer in `src/data/countries.js`, producing both wire records *and*
coarse country-centroid map signals (rendered as hollow rings, `precise:false`).
Add a feed by dropping a row into `FEEDS`; add a country by dropping a row into
`COUNTRIES` — both the tagger and the index pick it up automatically.

## The instability index

`src/analysis/instability.js` aggregates the fused event model into a per-country
score (0–100) and tier (**Critical / Severe / Elevated / Watch**). A country's
raw weight is the sum of its signals' mention counts, boosted by intensity, then
log-compressed against the busiest country so the score stays readable when one
hotspot dwarfs the rest. The wire attaches article counts and the latest
headline per country. Served at `GET /api/index`, shown as the left-panel board.

---

## Files

```
argus-server/
├── package.json
├── README.md
├── src/
│   ├── server.js          HTTP API + static host + ingest timer
│   ├── ingest.js          fetch all sources → fuse → score → store (runnable standalone)
│   ├── store.js           dedupe + persistence (swap for Postgres in prod)
│   ├── sources/
│   │   ├── gdelt.js        GDELT GEO + DOC adapter, normalizers, fallback
│   │   └── rss.js          RSS/Atom multi-feed adapter + country tagging + fallback
│   ├── analysis/
│   │   ├── instability.js  per-country instability index over the fused events
│   │   └── dossier.js      drill-in intelligence dossier (risk drivers + assessment)
│   ├── data/
│   │   └── countries.js    country gazetteer + free-text country tagger
│   └── fixtures/          bundled sample data (offline fallback, incl. rss.json)
└── public/
    ├── index.html         3D globe + 2D map, instability board, hotspots, wire, dossier
    └── land.js            baked-in world coastlines (Natural Earth 110m, simplified)
```

---

## Going to production (the next steps from the build map)

This model deliberately keeps things dependency-free. Done so far: **multi-source
ingestion** (GDELT + RSS) ✅ and a first **instability index** ✅. To harden it:

1. **Storage** → replace `src/store.js` with **Postgres + PostGIS** (geo
   queries) and **pgvector** (dedupe embeddings). The rest of the app is
   written against the same functions, so only this file changes.
2. **More sources** ✅ (RSS: ReliefWeb, UN News, Al Jazeera). Next: add Crisis
   Group / ReliefWeb-by-country, and ACLED (paid, precise) behind the same
   normalizer. GDELT stays the free backbone.
3. **Dedupe/cluster** → embed `title + place + time` and merge near-duplicate
   reports across sources into one event with multiple citations.
4. **Instability index** ✅ (first version). Next: add time-series so scores show
   escalation/de-escalation **trend**, not just current level.
5. **AI layer** → situation briefs + correlation engine over the stored events
   (Phase 3).
6. **Realtime** → push updates to the frontend over SSE instead of 60s polling.
7. **Deploy** → frontend on Vercel/Cloudflare; this server on Railway/Fly/Render;
   Postgres on Supabase/Neon.

---

*Working name VIGIL. GDELT data is free; verify terms before commercial launch.
ACLED and premium OSINT require licenses (see the build map).*
