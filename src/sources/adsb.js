// ADS-B military aircraft — live SIGINT-style air picture.
// Pulls the global military aircraft feed from adsb.fi (community ADS-B network,
// free & keyless), normalizes to map points. This is real multi-INT: transport,
// tanker, ISR and combat aircraft broadcasting position right now. Falls back to
// adsb.lol, then to empty on failure (never throws).

const ENDPOINTS = ['https://opendata.adsb.fi/api/v2/mil', 'https://api.adsb.lol/v2/mil'];
const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0; +https://vigil.local)';

// classify by ICAO type prefix into a coarse role (for the analyst, not exhaustive)
function roleOf(t = '', desc = '') {
  const s = (t + ' ' + desc).toUpperCase();
  if (/K35|KC|TANKER|A330 MRTT|VOYAGER/.test(s)) return 'Tanker';
  if (/RC13|RC-13|E3|E-3|E8|P8|P-8|RECON|SENTRY|RIVET|GLOBAL HAWK|RQ4|U2|EP3|EA/.test(s)) return 'ISR/Recon';
  if (/F16|F15|F18|F22|F35|F-1|EF|EUFI|TYPH|RAFALE|SU2|SU3|MIG|GRIPEN|FGT/.test(s)) return 'Fighter';
  if (/C17|C130|C5|A400|C-1|GLOBEMASTER|HERCULES|TRANSPORT|C-40|C40/.test(s)) return 'Transport';
  if (/H60|H-60|CH4|CH-4|AH6|UH|HELI|APACHE|CHINOOK|BLACKHAWK/.test(s)) return 'Helicopter';
  if (/B52|B-52|B1|B-1|B2|B-2|BOMBER/.test(s)) return 'Bomber';
  return 'Military';
}

async function grab(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(to); }
}

export async function fetchAircraft() {
  let data = null, live = false;
  for (const url of ENDPOINTS) { data = await grab(url); if (data && Array.isArray(data.ac)) { live = true; break; } }
  if (!data || !Array.isArray(data.ac)) return { events: [], live: false, sources: [] };

  const now = Date.now();
  const events = [];
  for (const a of data.ac) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    const role = roleOf(a.t, a.desc);
    const call = (a.flight || a.r || a.hex || '').trim();
    events.push({
      id: 'air:' + a.hex,
      lat: a.lat, lon: a.lon,
      layer: 'aircraft',
      label: call || a.hex,
      place: call || a.hex,
      role,
      type: a.t || '',
      alt: a.alt_baro === 'ground' ? 0 : (a.alt_baro || null),
      speed: a.gs || null,
      track: a.track ?? null,
      intensity: role === 'Bomber' || role === 'ISR/Recon' ? 0.9 : role === 'Fighter' || role === 'Tanker' ? 0.7 : 0.45,
      time: now,
      source: 'ADS-B',
      sub: `${a.desc || a.t || 'Military aircraft'} · ${role}${a.alt_baro && a.alt_baro !== 'ground' ? ' · FL' + Math.round(a.alt_baro / 100) : ''}${call ? ' · ' + call : ''}`,
    });
  }
  return { events, live, sources: live ? ['ADS-B Military'] : [] };
}
