// NASA FIRMS — satellite active-fire / thermal-anomaly detection (VIIRS/MODIS).
// This is the closest free proxy to satellite change-detection: near-real-time
// thermal hotspots that flag conflict fires, shelling, industrial strikes and
// wildfires. Needs a free FIRMS map key (firms.modaps.eosdis.nasa.gov). Activates
// when FIRMS_KEY is set; otherwise returns empty + "needs key" for health.
//
// We pull the global VIIRS_SNPP_NRT last-24h CSV area feed.

const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0)';

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const cols = lines[0].split(',');
  const li = { lat: cols.indexOf('latitude'), lon: cols.indexOf('longitude'), bright: cols.indexOf('bright_ti4') > -1 ? cols.indexOf('bright_ti4') : cols.indexOf('brightness'), conf: cols.indexOf('confidence'), frp: cols.indexOf('frp'), dt: cols.indexOf('acq_date') };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const lat = parseFloat(p[li.lat]), lon = parseFloat(p[li.lon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const frp = parseFloat(p[li.frp]) || 0;
    out.push({ lat, lon, frp, conf: p[li.conf], date: p[li.dt] });
  }
  return out;
}

export async function fetchFirms() {
  const key = process.env.FIRMS_KEY;
  if (!key) return { events: [], live: false, needsKey: true, sources: [] };
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/world/1`;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) return { events: [], live: false, needsKey: false, sources: [] };
    const rows = parseCsv(await r.text());
    const now = Date.now();
    // keep the highest-FRP detections to stay map-legible
    const events = rows.sort((a, b) => b.frp - a.frp).slice(0, 600).map((h, i) => ({
      id: 'firms:' + i + ':' + h.lat.toFixed(2) + ',' + h.lon.toFixed(2),
      lat: h.lat, lon: h.lon, layer: 'thermal',
      label: 'Thermal anomaly', place: `${h.lat.toFixed(2)}, ${h.lon.toFixed(2)}`,
      intensity: Math.min(1, h.frp / 50), frp: h.frp, time: now, source: 'NASA FIRMS',
      sub: `Thermal anomaly · FRP ${Math.round(h.frp)}MW · confidence ${h.conf} · VIIRS`,
    }));
    return { events, live: events.length > 0, needsKey: false, sources: ['NASA FIRMS'] };
  } catch { return { events: [], live: false, needsKey: false, sources: [] }; } finally { clearTimeout(to); }
}
