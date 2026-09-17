// Ingestion job: fetch all sources -> normalize -> fuse -> score -> store.
// Runs on a timer from the server, and can also be run standalone:  node src/ingest.js
//
// Sources (all real, free, keyless):
//   • GDELT GEO 2.0  -> precise geolocated conflict points  (the map)
//   • GDELT DOC 2.0  -> conflict article list               (the wire)
//   • RSS/Atom feeds -> humanitarian + wire articles, tagged to countries,
//                       plus coarse country-centroid signals (source fusion)
// Then computeInstability() rolls the fused event model into a per-country index.

import { fetchEvents, fetchWire } from './sources/gdelt.js';
import { fetchRss } from './sources/rss.js';
import { fetchNatural } from './sources/usgs.js';
import { fetchHazards } from './sources/hazards.js';
import { fetchAircraft, fetchCivAircraft } from './sources/adsb.js';
import { fetchVessels } from './sources/ais.js';
import { fetchFirms } from './sources/firms.js';
import { fetchTelegram } from './sources/telegram.js';
import { fetchCyber } from './sources/cyber.js';
import { isEnglish } from './lang.js';
import { computeInstability } from './analysis/instability.js';
import { load, upsertEvents, setWire, setIndex, setNatural, setHazards, setFeed, setMeta, getMeta, getEvents, appendHistory } from './store.js';

export async function runIngest() {
  // Each source is wrapped so a single failure/timeout can NEVER abort the whole
  // ingest — the cycle always completes with whatever succeeded and records lastIngest.
  const safe = (p, fb) => Promise.resolve(p).then((v) => v || fb).catch((e) => { console.error('[ingest] source failed:', e && e.message); return fb; });
  const [geo, doc, rss, natural, hazards, aircraft, civair, vessels, firms, telegram, cyber] = await Promise.all([
    safe(fetchEvents('24h'), { events: [], live: false }),
    safe(fetchWire('24h'), { wire: [], live: false }),
    safe(fetchRss(), { geo: [], wire: [], live: false, sources: [] }),
    safe(fetchNatural(), { events: [], live: false }),
    safe(fetchHazards(), { events: [], live: false, sources: [] }),
    safe(fetchAircraft(), { events: [], live: false, sources: [] }),
    safe(fetchCivAircraft(), { events: [], live: false, sources: [] }),
    safe(fetchVessels(), { events: [], live: false, sources: [] }),
    safe(fetchFirms(), { events: [], live: false, sources: [] }),
    safe(fetchTelegram(), { wire: [], live: false, sources: [] }),
    safe(fetchCyber(), { events: [], live: false, sources: [] }),
  ]);
  await setNatural(natural.events);
  await setHazards(hazards.events);
  // multi-INT point feeds (ADS-B live; AIS/FIRMS live when keyed)
  setFeed('aircraft', aircraft.events);
  setFeed('civair', civair.events);
  setFeed('vessels', vessels.events);
  setFeed('thermal', firms.events);
  setFeed('cyber', cyber.events);

  // Fuse events: GDELT precise points + RSS coarse country signals.
  const events = [
    ...geo.events.map((e) => ({ ...e, precise: true })),
    ...rss.geo, // already precise:false
  ];
  await upsertEvents(events);

  // Fuse wire: GDELT + RSS + Telegram OSINT, newest first. English-only (drop
  // non-Latin-script headlines) and reserve capacity for Telegram so high-volume
  // RSS/GDELT can't starve it out of the capped wire.
  // Deep wire (~1500) so the long tail of countries — not just the ~40 most-covered —
  // has reporting. A shallow cap made places like Venezuela show empty.
  const byTime = (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0);
  const mainstream = [...doc.wire, ...rss.wire].filter((a) => isEnglish(a.title)).sort(byTime);
  const tg = telegram.wire.filter((a) => isEnglish(a.title)).sort(byTime).slice(0, 150);
  const wire = [...mainstream.slice(0, 1400), ...tg].sort(byTime);
  // Provenance: stamp when OSINT retrieved each item (distinct from publishedAt),
  // so every downstream claim carries source + published + retrieved timestamps.
  const retrievedAt = Date.now();
  for (const w of wire) if (!w.retrievedAt) w.retrievedAt = retrievedAt;
  await setWire(wire);

  // Per-country instability index over the fused, stored event model.
  const index = computeInstability(getEvents(), wire);
  await setIndex(index);
  // snapshot the index for temporal trends / replay
  await appendHistory(index);

  const sources = [];
  if (geo.live) sources.push('GDELT GEO');
  if (doc.live) sources.push('GDELT DOC');
  for (const s of rss.sources) sources.push(s === 'sample' ? 'Sample RSS' : s);
  if (natural.live) sources.push('USGS');
  for (const s of hazards.sources) sources.push(s);
  for (const s of aircraft.sources) sources.push(s);
  for (const s of civair.sources) sources.push(s);
  for (const s of vessels.sources) sources.push(s);
  for (const s of firms.sources) sources.push(s);
  for (const s of telegram.sources) sources.push(s);
  for (const s of cyber.sources) sources.push(s);

  // multi-INT feed status (for /api/health → the launch-readiness panel)
  const feedStatus = {
    adsb: { name: 'ADS-B Military Air', live: aircraft.live, count: aircraft.events.length, needsKey: false },
    ais: { name: 'AIS Vessels', live: vessels.live, count: vessels.events.length, needsKey: !!vessels.needsKey, streaming: !!vessels.streaming },
    firms: { name: 'NASA FIRMS Thermal', live: firms.live, count: firms.events.length, needsKey: !!firms.needsKey },
  };

  const live = geo.live || doc.live || rss.live;
  setMeta({
    lastIngest: new Date().toISOString(),
    live,
    sources,
    source: live ? sources.join(' + ') : 'bundled sample (no network)',
    indexCount: index.count,
    feeds: feedStatus,
  });

  const m = getMeta();
  console.log(
    `[ingest] ${m.lastIngest} · ${events.length} events (${geo.events.length} GDELT + ${rss.geo.length} RSS) · ` +
      `${wire.length} articles · ${index.count} countries scored · ${m.live ? 'LIVE [' + sources.join(', ') + ']' : 'SAMPLE (offline)'}`
  );
  return m;
}

// allow standalone run
if (import.meta.url === `file://${process.argv[1]}`) {
  await load();
  await runIngest();
}
