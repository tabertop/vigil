// ADS-B military aircraft — live SIGINT-style air picture.
// Pulls the global military aircraft feed from adsb.fi (community ADS-B network,
// free & keyless), normalizes to map points. This is real multi-INT: transport,
// tanker, ISR and combat aircraft broadcasting position right now. Falls back to
// adsb.lol, then to empty on failure (never throws).

const ENDPOINTS = ['https://opendata.adsb.fi/api/v2/mil', 'https://api.adsb.lol/v2/mil'];
// Browser UA — some ADS-B mirrors throttle bot UAs from datacenter IPs (as Telegram does).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ICAO 24-bit address → country of registration (the operating nation). Ranges per
// ICAO Annex 10; covers the militaries that fly ADS-B most. Returns { country, iso }.
const ICAO_RANGES = [
  [0xA00000, 0xAFFFFF, 'United States', 'US'], [0x400000, 0x43FFFF, 'United Kingdom', 'GB'],
  [0x380000, 0x3BFFFF, 'France', 'FR'], [0x3C0000, 0x3FFFFF, 'Germany', 'DE'],
  [0x300000, 0x33FFFF, 'Italy', 'IT'], [0x340000, 0x37FFFF, 'Spain', 'ES'],
  [0x480000, 0x4BFFFF, 'Netherlands', 'NL'], [0x440000, 0x447FFF, 'Austria', 'AT'],
  [0x448000, 0x44FFFF, 'Belgium', 'BE'], [0x450000, 0x457FFF, 'Denmark', 'DK'],
  [0x460000, 0x467FFF, 'Finland', 'FI'], [0x468000, 0x46FFFF, 'Greece', 'GR'],
  [0x478000, 0x47FFFF, 'Norway', 'NO'], [0x4A0000, 0x4A7FFF, 'Sweden', 'SE'],
  [0x4B0000, 0x4B7FFF, 'Switzerland', 'CH'], [0x470000, 0x477FFF, 'Poland', 'PL'],
  [0x490000, 0x497FFF, 'Portugal', 'PT'], [0x4C0000, 0x4C7FFF, 'Türkiye', 'TR'],
  [0x140000, 0x1FFFFF, 'Russia', 'RU'], [0x500000, 0x5003FF, 'Ukraine', 'UA'],
  [0x508000, 0x50FFFF, 'Ukraine', 'UA'], [0x780000, 0x7BFFFF, 'China', 'CN'],
  [0x750000, 0x757FFF, 'India', 'IN'], [0x840000, 0x87FFFF, 'Japan', 'JP'],
  [0x718000, 0x71FFFF, 'South Korea', 'KR'], [0x738000, 0x73FFFF, 'Israel', 'IL'],
  [0x710000, 0x717FFF, 'Saudi Arabia', 'SA'], [0x760000, 0x767FFF, 'Iran', 'IR'],
  [0x896000, 0x896FFF, 'United Arab Emirates', 'AE'], [0x700000, 0x700FFF, 'Afghanistan', 'AF'],
  [0x7C0000, 0x7FFFFF, 'Australia', 'AU'], [0xC00000, 0xC3FFFF, 'Canada', 'CA'],
  [0xE00000, 0xE3FFFF, 'Argentina', 'AR'], [0xE40000, 0xE7FFFF, 'Brazil', 'BR'],
  [0x0A0000, 0x0A7FFF, 'Egypt', 'EG'], [0x008000, 0x00FFFF, 'South Africa', 'ZA'],
  [0x201000, 0x2013FF, 'Pakistan', 'PK'], [0x760000, 0x7607FF, 'Iran', 'IR'],
  [0x788000, 0x78FFFF, 'Taiwan', 'TW'], [0x800000, 0x83FFFF, 'India', 'IN'],
];
function icaoCountry(hex) {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  for (const [a, b, country, iso] of ICAO_RANGES) if (n >= a && n <= b) return { country, iso };
  return null;
}

// Common military callsign families → operator (best-effort; the "who's flying it").
const CALLSIGN_OPS = [
  [/^RCH/, 'US Air Mobility Command (Reach)'], [/^RRR/, 'Royal Air Force'],
  [/^CFC|^CANFORCE/, 'Canadian Forces'], [/^GAF/, 'German Air Force'],
  [/^FAF|^CTM|^COTAM/, 'French Air Force'], [/^IAM|^IAF/, 'Italian Air Force'],
  [/^NATO|^MMF/, 'NATO'], [/^FORTE|^HOMER|^JAKE|^GRZLY|^REDEYE/, 'US ISR/Recon'],
  [/^POLAF|^PLF/, 'Polish Air Force'], [/^HKY|^HAWK/, 'US Army'],
  [/^EVAC|^PAT/, 'US medevac/priority'], [/^NAVY|^CNV|^VVUS/, 'US Navy'],
  [/^UAF/, 'Ukrainian Air Force'], [/^RSD|^SAUDI/, 'Royal Saudi Air Force'],
  [/^IAF|^IsrAF/, 'Israeli Air Force'], [/^JAF/, 'Royal Jordanian Air Force'],
  [/^TUAF|^TUR/, 'Turkish Air Force'], [/^ASY|^AYB/, 'Australian Defence Force'],
];
function operatorOf(call, country) {
  const c = (call || '').toUpperCase();
  for (const [re, op] of CALLSIGN_OPS) if (re.test(c)) return op;
  return country ? country + ' military' : '';
}
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const headingOf = (t) => (t == null ? null : DIRS[Math.round(((t % 360) / 45)) % 8]);
const EMERGENCY = { 7500: 'HIJACK', 7600: 'RADIO FAILURE', 7700: 'GENERAL EMERGENCY' };

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
  const events = data.ac.map((a) => normalize(a, now, 'aircraft')).filter(Boolean);
  return { events, live, sources: live ? ['ADS-B Military'] : [] };
}

// Civilian role from the ADS-B emitter category (A1 light … A5 heavy, A7 rotorcraft).
function civRole(a) {
  const c = (a.category || '').toUpperCase();
  if (c === 'A7') return 'Helicopter';
  if (c === 'A5' || c === 'A4') return 'Widebody';
  if (c === 'A3') return 'Airliner';
  if (c === 'A1' || c === 'A2') return 'Light';
  if (/^(B7|A3|B73|B74|B75|B76|B77|B78|A32|A33|A34|A35)/.test((a.t || '').toUpperCase())) return 'Airliner';
  return 'Civilian';
}

// Shared normaliser → the enriched aircraft record used by both the military and
// civilian layers (so both get the same rich intel card).
function normalize(a, now, layer) {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const mil = layer === 'aircraft';
  const role = mil ? roleOf(a.t, a.desc) : civRole(a);
  const call = (a.flight || a.r || a.hex || '').trim();
  const nat = icaoCountry(a.hex) || {};
  const alt = a.alt_baro === 'ground' ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : null);
  const heading = headingOf(typeof a.track === 'number' ? a.track : null);
  const sq = a.squawk ? parseInt(a.squawk, 10) : null;
  const emergency = (sq && EMERGENCY[sq]) || (a.emergency && a.emergency !== 'none' ? String(a.emergency).toUpperCase() : '') || '';
  const hi = mil ? (role === 'Bomber' || role === 'ISR/Recon' ? 0.9 : role === 'Fighter' || role === 'Tanker' ? 0.7 : 0.45) : 0.28;
  return {
    id: 'air:' + a.hex, lat: a.lat, lon: a.lon, layer,
    label: call || a.hex, place: call || a.hex, role,
    type: a.t || '', desc: a.desc || '', hex: a.hex, reg: (a.r || '').trim(), callsign: (a.flight || '').trim(),
    country: nat.country || '', iso: nat.iso || '',
    operator: mil ? operatorOf(a.flight, nat.country) : (a.ownOp || ''),
    military: mil, squawk: a.squawk || '', emergency,
    alt, speed: typeof a.gs === 'number' ? Math.round(a.gs) : null,
    track: typeof a.track === 'number' ? Math.round(a.track) : null, heading,
    vsi: typeof a.baro_rate === 'number' ? a.baro_rate : null, category: a.category || '',
    intensity: emergency ? 1 : hi, time: now, source: 'ADS-B',
    sub: `${a.desc || a.t || (mil ? 'Military aircraft' : 'Civilian aircraft')} · ${role}${nat.country ? ' · ' + nat.country : ''}${alt ? ' · FL' + Math.round(alt / 100) : ''}${heading ? ' · hdg ' + heading : ''}${emergency ? ' · ⚠ ' + emergency : ''}`,
  };
}

// Obvious military callsigns to exclude from the civilian layer (the ingest hex
// cross-filter against the /mil feed removes the rest).
const MIL_CALLSIGN = /^(RCH|RRR|CFC|CANFORCE|GAF|FAF|CTM|COTAM|IAM|IAF|NATO|MMF|FORTE|HOMER|JAKE|GRZLY|REDEYE|POLAF|PLF|HKY|HAWK|EVAC|PAT|NAVY|CNV|VVUS|UAF|RSD|SAUDI|JAF|TUAF|TUR|ASY|AYB|SLAM|QID|SHELL|TOPCAT|VADER|BART)/;
// OpenSky emitter category index → coarse civilian class.
function openskyRole(c) {
  if (c === 8) return 'Helicopter';
  if (c === 6 || c === 5) return 'Widebody';
  if (c === 4 || c === 3) return 'Airliner';
  if (c === 2) return 'Light';
  if (c === 7) return 'High-perf';
  return 'Civilian';
}
const CIV_CAP = 1200; // plotted ceiling (the world has ~7-15k airborne at once)

// Global civilian air picture from the OpenSky Network — one anonymous request returns
// every aircraft broadcasting worldwide (with origin country), so unlike per-region
// point queries it isn't rate-limited into showing "only a few". Military is removed by
// callsign here and by hex cross-filter (vs the /mil feed) in ingest.
export async function fetchCivAircraft() {
  const now = Date.now();
  let j = null;
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://opensky-network.org/api/states/all', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(to);
    if (r.ok) j = await r.json();
  } catch { /* fall through to empty */ }
  if (!j || !Array.isArray(j.states)) return { events: [], live: false, sources: [] };

  const raw = [];
  for (const s of j.states) {
    const lon = s[5], lat = s[6];
    if (typeof lat !== 'number' || typeof lon !== 'number' || s[8]) continue; // valid + airborne
    const call = (s[1] || '').trim();
    if (MIL_CALLSIGN.test(call.toUpperCase())) continue;
    raw.push(s);
  }
  // Even global sample so the map isn't biased to whatever order OpenSky returns.
  const step = raw.length > CIV_CAP ? raw.length / CIV_CAP : 1;
  const events = [];
  for (let i = 0; i < raw.length && events.length < CIV_CAP; i += step) {
    const s = raw[Math.floor(i)];
    const hex = s[0], call = (s[1] || '').trim();
    const alt = typeof s[7] === 'number' ? Math.round(s[7] * 3.281) : null;      // m → ft
    const track = typeof s[10] === 'number' ? Math.round(s[10]) : null;
    const heading = headingOf(track);
    const sq = s[14] ? parseInt(s[14], 10) : null;
    const emergency = (sq && EMERGENCY[sq]) || '';
    const country = s[2] || (icaoCountry(hex) || {}).country || '';
    const role = openskyRole(s[17]);
    events.push({
      id: 'civ:' + hex, lat: s[6], lon: s[5], layer: 'civair',
      label: call || hex, place: call || hex, role,
      type: '', desc: '', hex, reg: '', callsign: call,
      country, iso: (icaoCountry(hex) || {}).iso || '', operator: '', military: false,
      squawk: s[14] || '', emergency,
      alt, speed: typeof s[9] === 'number' ? Math.round(s[9] * 1.944) : null,     // m/s → kt
      track, heading, vsi: typeof s[11] === 'number' ? Math.round(s[11] * 196.85) : null, // m/s → ft/min
      category: '', intensity: emergency ? 1 : 0.28, time: now, source: 'OpenSky',
      sub: `Civilian · ${role}${country ? ' · ' + country : ''}${alt ? ' · FL' + Math.round(alt / 100) : ''}${heading ? ' · hdg ' + heading : ''}${emergency ? ' · ⚠ ' + emergency : ''}`,
    });
  }
  return { events, live: true, sources: ['ADS-B Civilian (OpenSky)'] };
}
