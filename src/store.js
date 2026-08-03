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

const state = {
  events: new Map(), // id -> event (dedupe by id)
  wire: [],
  meta: { lastIngest: null, live: false, eventCount: 0, wireCount: 0 },
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
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(EVENTS_FILE, JSON.stringify([...state.events.values()]));
  await writeFile(WIRE_FILE, JSON.stringify(state.wire));
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
  state.wire = wire.slice(0, 80);
  state.meta.wireCount = state.wire.length;
  await persist();
}

export function getEvents() {
  return [...state.events.values()].sort((a, b) => b.count - a.count);
}
export function getWire() {
  return state.wire;
}
export function getMeta() {
  return state.meta;
}
export function setMeta(patch) {
  Object.assign(state.meta, patch);
}
