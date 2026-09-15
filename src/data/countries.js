// Country gazetteer — name/alias → { iso, name, lat, lon }.
// Used to (a) tag free-text RSS articles with a country and (b) aggregate the
// per-country instability index. Centroids are approximate (populated/capital
// region) — good enough to drop a coarse map signal and to group by country.
// Zero dependencies: this is just data + a small matcher.
//
// Focused on conflict- and instability-relevant states plus the majors. Extend
// freely — add a row and its aliases and both the tagger and the index pick it
// up automatically.

import { CENTROIDS } from './centroids.js';

const CURATED = [
  // { iso, name, lat, lon, aliases:[...] }  — aliases include demonyms/short forms
  { iso: 'UA', name: 'Ukraine', lat: 49.0, lon: 32.0, aliases: ['ukrainian', 'kyiv', 'kharkiv', 'donetsk', 'bakhmut', 'kupiansk', 'zaporizhzhia'] },
  { iso: 'RU', name: 'Russia', lat: 55.75, lon: 37.62, aliases: ['russian', 'moscow', 'kremlin', 'belgorod'] },
  { iso: 'SD', name: 'Sudan', lat: 15.5, lon: 32.56, aliases: ['sudanese', 'khartoum', 'darfur', 'el fasher', 'nyala', 'rsf'] },
  { iso: 'SS', name: 'South Sudan', lat: 4.85, lon: 31.6, aliases: ['juba'] },
  { iso: 'MM', name: 'Myanmar', lat: 19.75, lon: 96.1, aliases: ['burma', 'burmese', 'rakhine', 'sittwe', 'lashio', 'shan state', 'naypyidaw', 'junta'] },
  { iso: 'PS', name: 'Palestinian Territories', lat: 31.5, lon: 34.47, aliases: ['gaza', 'west bank', 'palestinian', 'palestine', 'rafah', 'khan younis'] },
  { iso: 'IL', name: 'Israel', lat: 31.78, lon: 35.22, aliases: ['israeli', 'idf', 'tel aviv', 'jerusalem'] },
  { iso: 'LB', name: 'Lebanon', lat: 33.89, lon: 35.5, aliases: ['lebanese', 'beirut', 'hezbollah'] },
  { iso: 'SY', name: 'Syria', lat: 34.8, lon: 38.9, aliases: ['syrian', 'damascus', 'aleppo', 'idlib'] },
  { iso: 'IQ', name: 'Iraq', lat: 33.31, lon: 44.36, aliases: ['iraqi', 'baghdad', 'mosul'] },
  { iso: 'IR', name: 'Iran', lat: 35.7, lon: 51.42, aliases: ['iranian', 'tehran', 'irgc'] },
  { iso: 'YE', name: 'Yemen', lat: 15.35, lon: 44.2, aliases: ['yemeni', 'sanaa', 'houthi', 'houthis', 'aden', 'bab-el-mandeb'] },
  { iso: 'AF', name: 'Afghanistan', lat: 34.53, lon: 69.17, aliases: ['afghan', 'kabul', 'taliban', 'kandahar'] },
  { iso: 'PK', name: 'Pakistan', lat: 33.69, lon: 73.06, aliases: ['pakistani', 'islamabad', 'karachi', 'waziristan', 'balochistan'] },
  { iso: 'SO', name: 'Somalia', lat: 2.05, lon: 45.34, aliases: ['somali', 'mogadishu', 'al-shabaab', 'al shabaab'] },
  { iso: 'ET', name: 'Ethiopia', lat: 9.03, lon: 38.74, aliases: ['ethiopian', 'addis ababa', 'tigray', 'amhara', 'oromia'] },
  { iso: 'ML', name: 'Mali', lat: 12.65, lon: -8.0, aliases: ['malian', 'bamako', 'wagner'] },
  { iso: 'BF', name: 'Burkina Faso', lat: 12.37, lon: -1.52, aliases: ['ouagadougou', 'burkinabe'] },
  { iso: 'NE', name: 'Niger', lat: 13.51, lon: 2.11, aliases: ['nigerien', 'niamey'] },
  { iso: 'NG', name: 'Nigeria', lat: 9.06, lon: 7.49, aliases: ['nigerian', 'abuja', 'lagos', 'boko haram'] },
  { iso: 'TD', name: 'Chad', lat: 12.11, lon: 15.05, aliases: ["n'djamena", 'ndjamena', 'chadian'] },
  { iso: 'CD', name: 'DR Congo', lat: -4.32, lon: 15.31, aliases: ['congo', 'congolese', 'kinshasa', 'goma', 'kivu', 'm23'] },
  { iso: 'CF', name: 'Central African Republic', lat: 4.39, lon: 18.56, aliases: ['bangui', 'car'] },
  { iso: 'CM', name: 'Cameroon', lat: 3.85, lon: 11.5, aliases: ['cameroonian', 'yaounde'] },
  { iso: 'MZ', name: 'Mozambique', lat: -25.97, lon: 32.58, aliases: ['maputo', 'cabo delgado'] },
  { iso: 'LY', name: 'Libya', lat: 32.89, lon: 13.19, aliases: ['libyan', 'tripoli', 'benghazi'] },
  { iso: 'EG', name: 'Egypt', lat: 30.04, lon: 31.24, aliases: ['egyptian', 'cairo', 'sinai'] },
  { iso: 'HT', name: 'Haiti', lat: 18.59, lon: -72.31, aliases: ['haitian', 'port-au-prince', 'gang'] },
  { iso: 'CO', name: 'Colombia', lat: 4.71, lon: -74.07, aliases: ['colombian', 'bogota', 'eln', 'farc'] },
  { iso: 'VE', name: 'Venezuela', lat: 10.48, lon: -66.9, aliases: ['venezuelan', 'caracas', 'maduro'] },
  { iso: 'MX', name: 'Mexico', lat: 19.43, lon: -99.13, aliases: ['mexican', 'cartel', 'sinaloa'] },
  { iso: 'TW', name: 'Taiwan', lat: 25.03, lon: 121.57, aliases: ['taiwanese', 'taipei', 'taiwan strait'] },
  { iso: 'CN', name: 'China', lat: 39.9, lon: 116.4, aliases: ['chinese', 'beijing', 'pla', 'south china sea'] },
  { iso: 'KP', name: 'North Korea', lat: 39.02, lon: 125.75, aliases: ['pyongyang', 'dprk', 'north korean'] },
  { iso: 'KR', name: 'South Korea', lat: 37.57, lon: 126.98, aliases: ['seoul', 'south korean'] },
  { iso: 'IN', name: 'India', lat: 28.61, lon: 77.21, aliases: ['indian', 'new delhi', 'kashmir'] },
  { iso: 'AM', name: 'Armenia', lat: 40.18, lon: 44.51, aliases: ['armenian', 'yerevan', 'nagorno-karabakh'] },
  { iso: 'AZ', name: 'Azerbaijan', lat: 40.41, lon: 49.87, aliases: ['azerbaijani', 'baku'] },
  { iso: 'GE', name: 'Georgia', lat: 41.72, lon: 44.79, aliases: ['tbilisi', 'abkhazia'] },
  { iso: 'RS', name: 'Serbia', lat: 44.79, lon: 20.45, aliases: ['belgrade', 'serbian'] },
  { iso: 'XK', name: 'Kosovo', lat: 42.67, lon: 21.17, aliases: ['pristina', 'kosovar'] },
  { iso: 'US', name: 'United States', lat: 38.9, lon: -77.04, aliases: ['american', 'washington', 'pentagon', 'u.s.', 'usa', 'hegseth', 'white house', 'capitol hill'] },
  { iso: 'GB', name: 'United Kingdom', lat: 51.51, lon: -0.13, aliases: ['britain', 'british', 'london', 'uk'] },
  { iso: 'FR', name: 'France', lat: 48.86, lon: 2.35, aliases: ['french', 'paris'] },
  { iso: 'DE', name: 'Germany', lat: 52.52, lon: 13.4, aliases: ['german', 'berlin'] },
  { iso: 'TR', name: 'Turkey', lat: 39.93, lon: 32.86, aliases: ['turkish', 'ankara', 'istanbul', 'turkiye'] },
  { iso: 'SA', name: 'Saudi Arabia', lat: 24.71, lon: 46.68, aliases: ['saudi', 'riyadh'] },
];

// Merge the full centroid table (170 countries) with the curated hotspot list.
// Curated rows keep their rich aliases; every other country is added with name-based
// matching (+ a few key aliases for multi-word names) so the tagger and instability
// index cover EVERY country, not just the 47 hotspots (fixes Mali, Niger, Chad, …).
const EXTRA_ALIASES = {
  CD: ['dr congo', 'democratic republic of the congo', 'democratic republic of congo', 'drc', 'kinshasa', 'congolese'],
  CG: ['republic of the congo', 'congo-brazzaville', 'brazzaville'],
  CF: ['central african republic', 'car', 'bangui'],
  CI: ["côte d'ivoire", 'ivory coast', 'ivorian', 'abidjan'],
  BF: ['burkina faso', 'burkinabe', 'ouagadougou'],
  GW: ['guinea-bissau', 'bissau'],
  GQ: ['equatorial guinea'],
  TL: ['timor-leste', 'east timor'],
  SZ: ['eswatini', 'swaziland'],
  CZ: ['czechia', 'czech republic'],
  MM: ['myanmar', 'burma', 'burmese', 'naypyidaw', 'yangon'],
  LA: ['laos', 'laotian', 'vientiane'],
  KH: ['cambodia', 'cambodian', 'phnom penh'],
  AE: ['uae', 'united arab emirates', 'emirati', 'abu dhabi'],
  MK: ['north macedonia', 'macedonia'],
  BA: ['bosnia', 'bosnia and herzegovina', 'sarajevo'],
  ML: ['malian', 'bamako'], NE: ['nigerien', 'niamey'], TD: ['chadian', "n'djamena"],
  SN: ['senegalese', 'dakar'], MR: ['mauritania', 'nouakchott'], MZ: ['mozambique', 'maputo'],
};
export const COUNTRIES = [...CURATED];
const _have = new Set(CURATED.map((c) => c.iso));
for (const iso in CENTROIDS) {
  if (_have.has(iso)) continue;
  const c = CENTROIDS[iso];
  COUNTRIES.push({ iso, name: c.name, lat: c.lat, lon: c.lon, aliases: EXTRA_ALIASES[iso] || [] });
}

// Build a lookup: every name + alias (lowercased) → its country record.
const INDEX = new Map();
for (const c of COUNTRIES) {
  INDEX.set(c.name.toLowerCase(), c);
  for (const a of c.aliases) INDEX.set(a.toLowerCase(), c);
}

export function countryByIso(iso) {
  if (!iso) return null;
  return COUNTRIES.find((c) => c.iso === String(iso).toUpperCase()) || null;
}

// Tag a blob of free text with the countries it mentions. Longest aliases are
// matched first (so "south sudan" wins over "sudan"), each country counted once,
// returned most-mentioned first. Word-boundary matching avoids "iran" ⊂ "tehran".
const KEYS = [...INDEX.keys()].sort((a, b) => b.length - a.length);
export function tagCountries(text) {
  if (!text) return [];
  const hay = ' ' + text.toLowerCase().replace(/[^a-z0-9'\- ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const hits = new Map(); // iso -> { country, count }
  for (const key of KEYS) {
    const needle = ' ' + key + ' ';
    let from = 0, n = 0, idx;
    while ((idx = hay.indexOf(needle, from)) !== -1) { n++; from = idx + 1; }
    if (n) {
      const c = INDEX.get(key);
      const cur = hits.get(c.iso);
      if (cur) cur.count += n;
      else hits.set(c.iso, { country: c, count: n });
    }
  }
  return [...hits.values()].sort((a, b) => b.count - a.count);
}
