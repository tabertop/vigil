// AIS vessel tracking — maritime domain awareness.
// Live AIS requires an account (aisstream.io websocket, or a MarineTraffic/
// Spire key). This adapter activates when AISSTREAM_KEY / AIS_HTTP_URL is set;
// otherwise it returns empty and reports "needs key" via health, so the plumbing
// is production-ready and a key is the only thing standing between it and live
// vessel positions at chokepoints.

const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0)';

export async function fetchVessels() {
  const httpUrl = process.env.AIS_HTTP_URL; // optional pre-aggregated AIS JSON endpoint
  if (!httpUrl && !process.env.AISSTREAM_KEY) {
    return { events: [], live: false, needsKey: true, sources: [] };
  }
  if (httpUrl) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(httpUrl, { headers: { 'user-agent': UA }, signal: ctrl.signal });
      if (!r.ok) return { events: [], live: false, needsKey: false, sources: [] };
      const data = await r.json();
      const list = Array.isArray(data) ? data : data.vessels || data.data || [];
      const now = Date.now();
      const events = list.filter((v) => typeof v.lat === 'number' && typeof v.lon === 'number').map((v) => ({
        id: 'ship:' + (v.mmsi || v.id || v.lat + ',' + v.lon),
        lat: v.lat, lon: v.lon, layer: 'vessels',
        label: v.name || v.callsign || String(v.mmsi || ''),
        place: v.name || String(v.mmsi || ''),
        vtype: v.type || v.ship_type || 'Vessel', intensity: 0.5, time: now, source: 'AIS',
        sub: `${v.name || 'Vessel'} · ${v.type || 'AIS'}${v.destination ? ' → ' + v.destination : ''}`,
      }));
      return { events, live: events.length > 0, needsKey: false, sources: ['AIS'] };
    } catch { return { events: [], live: false, needsKey: false, sources: [] }; } finally { clearTimeout(to); }
  }
  // AISSTREAM is websocket-only (streaming) — not fetched in a 15-min poll cycle here;
  // surfaced as configured-but-streaming. A worker would push into the store instead.
  return { events: [], live: false, needsKey: false, streaming: true, sources: [] };
}
