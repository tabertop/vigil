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
//
// MAINTENANCE: t.me/s/ public previews can be turned off by a channel or freeze on
// an old archive — either way the channel silently stops contributing. All channels
// below were verified live (posting within 4 days) when last audited; fetchTelegram()
// logs any that return zero posts on every ingest, so dead feeds surface in the logs
// for re-audit. Removed as dead/frozen: Militarylandnet, NOELreports, Osinttechnical
// (frozen 2022), IntelCrab, Faytuks (frozen), sentdefender, Global_Mil_Info,
// ASB_Military_News, warfare_analysis, IntelRepublic, Suriyakmaps, visegrad24,
// worldsource24. Re-add if their previews come back.
export const TG_CHANNELS = [
  // Ukraine / Russia theater
  { ch: 'DeepStateUA', grade: 'C', note: 'Ukraine frontline mapping' },
  { ch: 'wartranslated', grade: 'C', note: 'Primary-source translations' },
  { ch: 'KyivIndependent_official', grade: 'C', note: 'Ukrainian outlet (English)' },
  { ch: 'rybar', grade: 'D', note: 'Russian mil (pro-RU)' },
  { ch: 'Tass_agency', grade: 'D', note: 'Russian state agency' },
  { ch: 'war_monitor', grade: 'D', note: 'General conflict' },
  { ch: 'WarMonitors', grade: 'D', note: 'General conflict' },
  // Military / conflict OSINT
  { ch: 'ClashReport', grade: 'C', note: 'Conflict OSINT (English)' },
  { ch: 'BellumActaNews', grade: 'D', note: 'Conflict news (English)' },
  { ch: 'DDGeopolitics', grade: 'D', note: 'Geopolitics (English)' },
  { ch: 'Megatron_ron', grade: 'D', note: 'Middle East monitor' },
  // Middle East / other theaters
  { ch: 'Osint613', grade: 'C', note: 'Israel/MENA OSINT' },
  { ch: 'IsraelWarRoom', grade: 'D', note: 'Israel/MENA (English)' },
  // News aggregators (English)
  { ch: 'insiderpaper', grade: 'D', note: 'Breaking-news aggregator' },
  { ch: 'worldnews', grade: 'D', note: 'World news' },
  { ch: 'disclosetv', grade: 'D', note: 'Breaking news' },
];

const UA = 'Mozilla/5.0 (compatible; VigilMonitor/1.0; +https://vigil.local)';

// Telegram is a LIVE wire — drop anything older than this. Some channels' public
// web previews are frozen on an old archive (e.g. t.me/s/Osinttechnical still
// serves June-2022 posts), and stamping those "now" pinned years-stale headlines
// to the top of the wire forever. Only genuinely recent posts belong here.
const MAX_AGE_MS = 4 * 864e5; // 4 days

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
    // Require a real, recent publish time from the message's <time datetime>.
    // Drop anything unparseable, implausibly future, or older than MAX_AGE — this
    // is what stops frozen-archive channels from re-injecting stale posts as "new"
    // on every ingest (the bug that pinned a 2022 headline to the wire for days).
    const ts = time ? Date.parse(time[1]) : NaN;
    if (!isFinite(ts) || ts > Date.now() + 36e5 || ts < Date.now() - MAX_AGE_MS) continue;
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
    // t.me/s/ lists posts oldest→newest, so sort by time and take the freshest 12.
    const posts = (await grab(c.ch)).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 12);
    return posts.map((p) => {
      const isos = tagCountries(p.title).map((t) => t.country.iso);
      return {
        id: p.id, title: p.title, url: p.url, domain: 't.me',
        source: 'TG ' + c.ch, country: '', countries: isos,
        publishedAt: p.publishedAt || Date.now(),
      };
    });
  }));
  // Track live vs dead per channel so dead/frozen feeds surface in the logs every
  // ingest (they're re-fetched each cycle, so a channel that comes back is picked
  // up automatically — and one that dies is flagged for re-audit).
  const wire = [];
  const liveChans = [], deadChans = [];
  results.forEach((r, i) => {
    const name = TG_CHANNELS[i].ch;
    if (r.status === 'fulfilled' && r.value.length) { liveChans.push(name); wire.push(...r.value); }
    else deadChans.push(name);
  });
  console.log(`[telegram] ${liveChans.length}/${TG_CHANNELS.length} channels live · ${wire.length} fresh posts`);
  if (deadChans.length) console.warn('[telegram] no fresh posts (prune/re-audit): ' + deadChans.join(', '));
  return { wire, live: liveChans.length > 0, channels: liveChans.length, sources: liveChans.length ? ['Telegram (' + liveChans.length + ' channels)'] : [] };
}
