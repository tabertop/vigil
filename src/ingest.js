// Ingestion job: fetch GDELT -> normalize -> store.
// Runs on a timer from the server, and can also be run standalone:  node src/ingest.js

import { fetchEvents, fetchWire } from './sources/gdelt.js';
import { load, upsertEvents, setWire, setMeta, getMeta } from './store.js';

export async function runIngest() {
  const [e, w] = await Promise.all([fetchEvents('24h'), fetchWire('24h')]);
  await upsertEvents(e.events);
  await setWire(w.wire);
  setMeta({
    lastIngest: new Date().toISOString(),
    live: e.live && w.live,
    source: e.live ? 'GDELT (live)' : 'bundled sample (no network)',
  });
  const m = getMeta();
  console.log(
    `[ingest] ${m.lastIngest} · ${e.events.length} geo points · ${w.wire.length} articles · ${m.live ? 'LIVE GDELT' : 'SAMPLE (offline)'}`
  );
  return m;
}

// allow standalone run
if (import.meta.url === `file://${process.argv[1]}`) {
  await load();
  await runIngest();
}
