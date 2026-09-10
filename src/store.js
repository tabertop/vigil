// Minimal persistence layer.
// Zero-dependency file+memory store so the project runs with just `node`.
// In production this is the seam where you swap in Postgres + PostGIS
// (see README → "Going to production"). The rest of the app doesn't change.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVENTS_FILE = join(DATA_DIR, 'events.json');
const WIRE_FILE = join(DATA_DIR, 'wire.json');
const INDEX_FILE = join(DATA_DIR, 'index.json');
const NATURAL_FILE = join(DATA_DIR, 'natural.json');
const HAZARDS_FILE = join(DATA_DIR, 'hazards.json');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const CASES_FILE = join(DATA_DIR, 'cases.json');

// per-ingest index snapshots retained for trend/replay (7d @ 15min ≈ 672)
const HISTORY_CAP = 800;

const state = {
  events: new Map(), // id -> event (dedupe by id)
  wire: [],
  natural: [], // USGS natural events (earthquakes)
  hazards: [], // EONET + GDACS hazard events (fires, storms, floods, volcanoes, drought)
  index: { generatedAt: null, count: 0, countries: [] }, // instability index
  history: [], // [{ at, countries:[{iso,score}] }] — index score over time
  feeds: { aircraft: [], vessels: [], thermal: [], cyber: [] }, // multi-INT point layers (ADS-B, AIS, FIRMS, cyber)
  cases: [], // analyst investigations (case files)
  meta: { lastIngest: null, live: false, eventCount: 0, wireCount: 0, sources: [] },
};

export async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const e = JSON.parse(await readFile(EVENTS_FILE, 'utf8'));
    for (const ev of e) state.events.set(ev.id, ev);
  } catch {}
  try {
    state.wire = JSON.parse(await readFile(WIRE_FILE, 'utf8'));
  } catch {}
  try {
    state.index = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
  } catch {}
  try {
    state.natural = JSON.parse(await readFile(NATURAL_FILE, 'utf8'));
  } catch {}
  try {
    state.hazards = JSON.parse(await readFile(HAZARDS_FILE, 'utf8'));
  } catch {}
  try {
    state.history = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
  } catch {}
  try {
    state.cases = JSON.parse(await readFile(CASES_FILE, 'utf8'));
  } catch {}
}

async function persistCases() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CASES_FILE, JSON.stringify(state.cases, null, 2));
}
export function getCases() { return state.cases; }
export function getCase(id) { return state.cases.find((c) => c.id === id) || null; }
export async function saveCase(c) {
  const i = state.cases.findIndex((x) => x.id === c.id);
  if (i > -1) state.cases[i] = c; else state.cases.unshift(c);
  await persistCases();
  return c;
}
export async function deleteCase(id) {
  state.cases = state.cases.filter((c) => c.id !== id);
  await persistCases();
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(EVENTS_FILE, JSON.stringify([...state.events.values()]));
  await writeFile(WIRE_FILE, JSON.stringify(state.wire));
  await writeFile(INDEX_FILE, JSON.stringify(state.index));
  await writeFile(NATURAL_FILE, JSON.stringify(state.natural));
  await writeFile(HAZARDS_FILE, JSON.stringify(state.hazards));
  await writeFile(HISTORY_FILE, JSON.stringify(state.history));
}

export async function upsertEvents(events) {
  for (const ev of events) state.events.set(ev.id, ev); // dedupe by stable id
  // keep the map from growing unbounded — retain the freshest 500
  if (state.events.size > 500) {
    const sorted = [...state.events.values()].sort((a, b) => b.ingestedAt - a.ingestedAt).slice(0, 500);
    state.events = new Map(sorted.map((e) => [e.id, e]));
  }
  state.meta.eventCount = state.events.size;
  await persist();
}

export async function setWire(wire) {
  state.wire = wire.slice(0, 1600); // deep wire so the long tail of countries has coverage
  state.meta.wireCount = state.wire.length;
  await persist();
}

export async function setIndex(index) {
  state.index = index;
  await persist();
}

export async function setNatural(events) {
  state.natural = events;
  state.meta.naturalCount = events.length;
  await persist();
}
export function getNatural() {
  return state.natural;
}

export async function setHazards(events) {
  state.hazards = events;
  state.meta.hazardCount = events.length;
  await persist();
}
export function getHazards() {
  return state.hazards;
}

// Append a compact snapshot of the current index for trend/replay history.
// Stores only iso+score to stay small; capped to HISTORY_CAP most-recent points.
export async function appendHistory(index) {
  const at = (index && index.generatedAt) || new Date().toISOString();
  // guard against duplicate snapshots on rapid restarts (same generatedAt)
  if (state.history.length && state.history[state.history.length - 1].at === at) return;
  const countries = (index.countries || []).map((c) => ({ iso: c.iso, score: c.score }));
  state.history.push({ at, countries });
  if (state.history.length > HISTORY_CAP) state.history = state.history.slice(-HISTORY_CAP);
  await persist();
}
export function getHistory() {
  return state.history;
}

// multi-INT point feeds (ADS-B aircraft, AIS vessels, FIRMS thermal) — transient,
// not persisted to disk (they refresh every cycle and are large/fast-moving).
export function setFeed(name, events) {
  state.feeds[name] = events || [];
  state.meta[name + 'Count'] = state.feeds[name].length;
}
export function getFeed(name) {
  return state.feeds[name] || [];
}

export function getEvents() {
  return [...state.events.values()].sort((a, b) => b.count - a.count);
}
export function getWire() {
  return state.wire;
}
export function getIndex() {
  return state.index;
}
export function getMeta() {
  return state.meta;
}
export function setMeta(patch) {
  Object.assign(state.meta, patch);
}
