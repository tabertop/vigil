-- VIGIL production schema — Postgres + PostGIS + pgvector.
-- This is the storage foundation the JSON store (src/store.js) is designed to be
-- swapped for. It adds three things the file store can't: geospatial indexing
-- (PostGIS), semantic dedup / entity resolution (pgvector), and durable history
-- at scale. Apply with:  psql "$DATABASE_URL" -f db/schema.sql
--
-- Then run VIGIL with:   STORAGE=pg DATABASE_URL=postgres://… npm start
-- (src/db/pg.js implements the same interface as src/store.js against these tables.)

CREATE EXTENSION IF NOT EXISTS postgis;   -- geometry(Point,4326), GIST spatial index
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: embedding similarity for dedup

-- ── Geolocated signals (GDELT precise points + RSS country-centroid signals) ──
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,          -- stable hash → re-ingest upserts, never piles up
  geom         geometry(Point, 4326) NOT NULL,
  place        TEXT,
  count        INTEGER DEFAULT 1,
  intensity    REAL DEFAULT 0,
  type         TEXT,
  source       TEXT,
  precise      BOOLEAN DEFAULT TRUE,
  event_time   TIMESTAMPTZ,
  ingested_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_geom_idx ON events USING GIST (geom);
CREATE INDEX IF NOT EXISTS events_time_idx ON events (event_time DESC);

-- ── Wire (multi-source articles) with full-text + embedding for entity resolution ──
CREATE TABLE IF NOT EXISTS wire (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  url          TEXT,
  domain       TEXT,
  source       TEXT,
  grade        CHAR(1),                   -- Admiralty reliability grade (A..D,U)
  countries    TEXT[],                    -- ISO codes tagged in the article
  published_at TIMESTAMPTZ,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,''))) STORED,
  embedding    vector(256),               -- title+place+time embedding for dedup/cluster
  event_id     TEXT REFERENCES fused_events(id) ON DELETE SET NULL  -- which fused event it belongs to
);
CREATE INDEX IF NOT EXISTS wire_tsv_idx ON wire USING GIN (tsv);
CREATE INDEX IF NOT EXISTS wire_pub_idx ON wire (published_at DESC);
-- approximate-nearest-neighbour index for semantic dedup (cosine distance)
CREATE INDEX IF NOT EXISTS wire_embed_idx ON wire USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Fused events (the intelligence core: N reports → 1 corroborated event) ──
CREATE TABLE IF NOT EXISTS fused_events (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  geom          geometry(Point, 4326),
  countries     TEXT[],
  severity      SMALLINT,
  confidence    SMALLINT,                 -- 0..100
  conf_level    TEXT,                     -- CONFIRMED / PROBABLE / SINGLE-SOURCE
  source_count  SMALLINT,
  first_seen    TIMESTAMPTZ,
  last_seen     TIMESTAMPTZ,
  centroid_embedding vector(256)          -- for merging events across ingest cycles
);
CREATE INDEX IF NOT EXISTS fused_geom_idx ON fused_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS fused_embed_idx ON fused_events USING ivfflat (centroid_embedding vector_cosine_ops) WITH (lists = 100);

-- ── Per-country instability index, snapshotted every ingest (durable history) ──
CREATE TABLE IF NOT EXISTS index_history (
  at     TIMESTAMPTZ NOT NULL,
  iso    CHAR(2) NOT NULL,
  score  SMALLINT NOT NULL,
  tier   TEXT,
  PRIMARY KEY (at, iso)
);
CREATE INDEX IF NOT EXISTS idxhist_iso_idx ON index_history (iso, at DESC);

-- ── Accounts, RBAC, audit (mirrors src/auth.js + src/audit.js) ──
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  role     TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','analyst','admin')),
  salt     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ DEFAULT now(),
  username TEXT,
  role    TEXT,
  action  TEXT,
  detail  TEXT,
  ip      INET
);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log (ts DESC);

-- ── Entity-resolution helper: find the fused event a new report belongs to ──
-- Usage from the app: SELECT * FROM match_event($1::vector, 0.15);
-- Returns the nearest fused event within a cosine-distance threshold, or nothing
-- (→ create a new event). This is what collapses duplicate reporting into one
-- corroborated event across ingest cycles, at scale, in the database.
CREATE OR REPLACE FUNCTION match_event(emb vector(256), max_dist real)
RETURNS TABLE(id TEXT, dist real) LANGUAGE sql STABLE AS $$
  SELECT id, (centroid_embedding <=> emb) AS dist
  FROM fused_events
  WHERE centroid_embedding IS NOT NULL AND (centroid_embedding <=> emb) < max_dist
  ORDER BY centroid_embedding <=> emb
  LIMIT 1;
$$;
