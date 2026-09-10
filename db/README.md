# VIGIL — Postgres / PostGIS / pgvector storage

The default store is zero-dependency JSON files (`src/store.js`). For production —
scale, geospatial queries, and cross-cycle **entity resolution** — swap in the
Postgres adapter (`src/db/pg.js`), which implements the identical interface.

## Setup

```bash
# 1. a Postgres 15+ with PostGIS and pgvector available
createdb vigil
psql "$DATABASE_URL" -f db/schema.sql

# 2. add the driver (the only non-builtin dependency, and only for this path)
npm i pg

# 3. run VIGIL against it
STORAGE=pg DATABASE_URL=postgres://user:pass@host:5432/vigil AUTH_SECRET=$(openssl rand -hex 32) npm start
```

To activate the adapter, point the app's store imports at `src/db/pg.js`
(in `src/server.js` and `src/ingest.js`, change `from './store.js'` /
`from '../store.js'` to the pg module), or add a selector shim. The function
signatures match exactly, so nothing else changes.

## What the DB path adds over the file store

- **PostGIS** — `geometry(Point,4326)` + GIST indexes for fast spatial queries.
- **pgvector entity resolution** — every incoming report is embedded and matched
  to an existing fused event via `match_event()` (cosine distance), so duplicate
  reporting collapses into one corroborated event **across ingest cycles**, not
  just within a single window. This is the piece the in-memory clustering can't do.
- **Durable history** — `index_history` is a real time series (not a capped array),
  which is what the forecasting and backtesting improve on as it grows.
- **Accounts & audit** in the DB (`users`, `audit_log`) for multi-node deployments.

The JSON embedding in `pg.js` (`embed()`) is a hashing stand-in; swap it for a
learned sentence embedding (same 256-dim vector column) for production-grade dedup.
