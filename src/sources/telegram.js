// Telegram monitoring — where live conflict OSINT actually breaks.
// Telegram's public channels expose a keyless web preview at t.me/s/<channel>;
// we fetch a curated set of conflict/OSINT channels, parse recent posts, country-
// tag them, and fold them into the wire alongside RSS/GDELT. Treated with caution:
// Telegram is raw, unverified, and includes propaganda — sources are graded low
// (C for established monitors, D by default), so the fusion/confidence model never
// lets a single channel drive a CONFIRMED assessment on its own.
//
// Zero-dependency: HTML is parsed with focused regexes over the widget markup.

import { tagCountries } from '../data/countries.js';

// Curated channels. grade: C = established monitor, D = caution (default).
// Deliberately spans theaters and viewpoints — corroboration is handled downstream.
export const TG_CHANNELS = [
  // Ukraine / Russia theater
  { ch: 'DeepStateUA', grade: 'C', note: 'Ukraine frontline mapping' },
  { ch: 'Militarylandnet', grade: 'C', note: 'Ukraine order of battle' },
  { ch: 'wartranslated', grade: 'C', note: 'Primary-source translations' },
  { ch: 'NOELreports', grade: 'C', note: 'Ukraine war updates' },
  { ch: 'rybar', grade: 'D', note: 'Russian mil (pro-RU)' },
  { ch: 'Tass_agency', grade: 'D', note: 'Russian state agency' },
  // Military / conflict OSINT
  { ch: 'Osinttechnical', grade: 'C', note: 'Military OSINT' },
  { ch: 'IntelCrab', grade: 'C', note: 'Conflict OSINT' },
  { ch: 'Faytuks', grade: 'C', note: 'Breaking-news aggregator' },
  { ch: 'sentdefender', grade: 'D', note: 'Global mil monitor' },
  { ch: 'war_monitor', grade: 'D', note: 'General conflict' },
  { ch: 'WarMonitors', grade: 'D', note: 'General conflict' },
  { ch: 'Global_Mil_Info', grade: 'D', note: 'Military news' },
  { ch: 'ASB_Military_News', grade: 'D', note: 'Military news' },
  { ch: 'warfare_analysis', grade: 'D', note: 'Conflict analysis' },
  { ch: 'IntelRepublic', grade: 'D', note: 'Geopolitics' },
  // Middle East / other theaters
  { ch: 'Osint613', grade: 'C', note: 'Israel/MENA OSINT' },
  { ch: 'Megatron_ron', grade: 'D', note: 'Middle East monitor' },
  { ch: 'Suriyakmaps', grade: 'D', note: 'Syria/MENA mapping' },
  // News aggregators
  { ch: 'visegrad24', grade: 'C', note: 'Breaking geopolitics' },
  { ch: 'disclosetv', grade: 'D', note: 'Breaking news' },
  { ch: 'worldsource24', grade: 'D', note: 'World news' },
];

const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0; +https://vigil.local)';

function decode(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')          // strip inline tags (a/b/i/emoji/span)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseChannel(html, ch) {
  const out = [];
  // each post is a .tgme_widget_message block; split on it and parse each chunk
  const blocks = html.split('tgme_widget_message ');
  for (const b of blocks) {
    const post = b.match(/data-post="([^"]+)"/);
    const text = b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const time = b.match(/datetime="([^"]+)"/);
    if (!post || !text) continue;
    const title = decode(text[1]);
    if (title.length < 12) continue; // skip media-only / trivial posts
    // t.me/s/ shows only recent posts; treat an unparseable/out-of-range datetime
    // (forwarded-message artifacts can yield stale values) as current.
    let ts = time ? Date.parse(time[1]) : NaN;
    if (!isFinite(ts) || ts > Date.now() + 36e5 || ts < Date.now() - 14 * 864e5) ts = Date.now();
    out.push({
      id: 'tg:' + post[1],
      url: 'https://t.me/' + post[1],
      title: title.length > 240 ? title.slice(0, 237) + '…' : title,
      publishedAt: ts,
    });
  }
  return out;
}

async function grab(ch) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://t.me/s/' + ch, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return [];
    return parseChannel(await r.text(), ch);
  } catch { return []; } finally { clearTimeout(to); }
}

export async function fetchTelegram() {
  const results = await Promise.allSettled(TG_CHANNELS.map(async (c) => {
    const posts = await grab(c.ch);
    return posts.slice(0, 12).map((p) => {
      const isos = tagCountries(p.title).map((t) => t.country.iso);
      return {
        id: p.id, title: p.title, url: p.url, domain: 't.me',
        source: 'TG ' + c.ch, country: '', countries: isos,
        publishedAt: p.publishedAt || Date.now(),
      };
    });
  }));
  const wire = [];
  let liveChannels = 0;
  for (const r of results) if (r.status === 'fulfilled' && r.value.length) { liveChannels++; wire.push(...r.value); }
  return { wire, live: liveChannels > 0, channels: liveChannels, sources: liveChannels ? ['Telegram (' + liveChannels + ' channels)'] : [] };
}
