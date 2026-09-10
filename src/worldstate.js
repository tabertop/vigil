// World-state cache — the single computed "operating picture" for a time window.
// Previously every endpoint recomputed the index, then correlation recomputed the
// index again, then warnings recomputed index+correlation+forecast, then
// threatlevel recomputed ALL of it, then predict recomputed it once more — several
// times per second during a frontend refresh, and with subtle inconsistencies
// between panels. This computes each layer ONCE per (window) and memoizes it for a
// short TTL, so the whole dashboard reads one coherent, consistent snapshot.
//
// Response shapes are unchanged — this is a pure performance/consistency refactor.

import { computeInstability } from './analysis/instability.js';
import { computeCorrelation } from './analysis/correlation.js';
import { computeForecast } from './analysis/forecast.js';
import { computeWarnings } from './analysis/warnings.js';
import { computeThreatLevel } from './analysis/threatlevel.js';
import { fuseEvents } from './analysis/fusion.js';
import { buildTopNews } from './analysis/topnews.js';
import { computeLinkGraph } from './analysis/linkgraph.js';
import { computePredictions } from './analysis/predict.js';

const TTL_MS = 45 * 1000;           // matches the ~60s frontend poll; recompute at most ~once/window/45s
const cache = new Map();            // windowKey -> { at, state }

// inputs: { events (windowed), wire (windowed), history, feeds:{aircraft,...} }
// windowKey: the ?window= value (e.g. '24h','all') — the cache dimension.
export function getWorldState(windowKey, inputs) {
  const hit = cache.get(windowKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
  const state = build(inputs);
  cache.set(windowKey, { at: Date.now(), state });
  return state;
}

// Force a fresh recompute (called right after ingest so the first request is warm).
export function primeWorldState(windowKey, inputs) {
  const state = build(inputs);
  cache.set(windowKey, { at: Date.now(), state });
  return state;
}

export function invalidateWorldState() { cache.clear(); }

function build({ events = [], wire = [], history = [], feeds = {} }) {
  const index = computeInstability(events, wire);
  const correlation = computeCorrelation(wire, events, index);
  const forecast = computeForecast(history, { horizonH: 72 });
  const warnings = computeWarnings({ index, events, wire, correlation, forecast, aircraft: feeds.aircraft || [] });
  const threat = computeThreatLevel({ index, warnings, correlation });
  const fusion = fuseEvents(wire);
  const topnews = buildTopNews(wire);
  const linkgraph = computeLinkGraph(wire);
  const predictions = computePredictions({ index, warnings, forecast, correlation });
  return { generatedAt: new Date().toISOString(), index, correlation, forecast, warnings, threat, fusion, topnews, linkgraph, predictions };
}
