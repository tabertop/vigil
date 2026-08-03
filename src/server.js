// ARGUS backend — HTTP API + static frontend. Zero external dependencies.
//   GET /api/health   -> ingest status
//   GET /api/events   -> GeoJSON FeatureCollection of geolocated conflict signals
//   GET /api/wire     -> latest conflict news articles
//   GET /             -> the live globe frontend (public/index.html)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { load, getEvents, getWire, getMeta } from './store.js';
import { runIngest } from './ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8787;
const INGEST_EVERY_MS = 15 * 60 * 1000; // GDELT updates ~every 15 min

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

// events -> GeoJSON so the frontend map can consume it directly
function eventsGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: getEvents().map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { id: e.id, place: e.place, count: e.count, intensity: e.intensity, type: e.type, source: e.source },
    })),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/api/health') return json(res, getMeta());
  if (path === '/api/events') return json(res, eventsGeoJSON());
  if (path === '/api/wire') return json(res, getWire());

  // static files
  let file = path === '/' ? '/index.html' : path;
  file = file.replace(/\.\./g, ''); // basic traversal guard
  try {
    const buf = await readFile(join(PUBLIC, file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

await load();
await runIngest();                       // ingest once on boot
setInterval(runIngest, INGEST_EVERY_MS); // then on a timer

server.listen(PORT, () => {
  const m = getMeta();
  console.log(`\n  ARGUS server → http://localhost:${PORT}`);
  console.log(`  data source: ${m.source || 'unknown'}\n`);
});
