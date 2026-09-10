// Cyber events — ransomware / extortion incidents from ransomware.live (free,
// keyless). Each recently-listed victim is geolocated to its country and placed on
// the map as a cyber-incident point (group, sector, victim). This adds the "cyber
// events" INT stream to the common event model. Falls back to empty on failure.

import { centroidFor } from '../data/centroids.js';

const URL = 'https://api.ransomware.live/v1/recentvictims';
const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0; +https://vigil.local)';

// small deterministic jitter so multiple victims in one country don't stack exactly
function jitter(seed) { let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0; return ((Math.abs(h) % 1000) / 1000 - 0.5) * 3; }

export async function fetchCyber() {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(URL, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'follow', signal: ctrl.signal });
    if (!r.ok) return { events: [], live: false, sources: [] };
    const list = await r.json();
    if (!Array.isArray(list)) return { events: [], live: false, sources: [] };
    const now = Date.now();
    const events = [];
    for (const v of list) {
      const iso = (v.country || '').toUpperCase();
      const c = centroidFor(iso);
      if (!c) continue;
      const victim = v.post_title || v.website || 'undisclosed target';
      const group = v.group_name || 'unknown group';
      const when = Date.parse(v.discovered || v.published || '') || now;
      events.push({
        id: 'cyber:' + (v.post_url || (group + ':' + victim)).slice(0, 80),
        lat: c.lat + jitter(victim + iso), lon: c.lon + jitter(group + victim),
        layer: 'cyber', label: victim, place: c.name,
        group, sector: v.activity || '', country: iso,
        intensity: 0.6, time: when, source: 'ransomware.live',
        sub: `Ransomware · ${group} → ${victim}${v.activity ? ' (' + v.activity + ')' : ''} · ${c.name}`,
      });
    }
    return { events, live: events.length > 0, sources: events.length ? ['ransomware.live'] : [] };
  } catch { return { events: [], live: false, sources: [] }; } finally { clearTimeout(to); }
}
