// Source reliability registry — the trust layer under every score.
// Intelligence work grades its sources; a claim from a wire service and a claim
// from a state broadcaster do not carry equal weight. We use a simplified
// NATO Admiralty-style reliability grade (A best … F unrated) mapped to a numeric
// weight used by the fusion/confidence model. Grades are assigned by outlet class,
// not by story — reliability is a property of the source, credibility of the claim
// (credibility is handled downstream by corroboration).
//
// Grade → weight:  A 1.00 · B 0.85 · C 0.70 · D 0.50 (state-affiliated / caution) · U 0.60 (unrated default)

const A = ['ReliefWeb', 'UN News', 'WHO News', 'UNHCR', 'OCHA', 'Crisis Group', 'ACLED', 'ISW', 'AP Top News', 'Reuters World', 'Reuters', 'AP', 'AFP', 'Bellingcat', 'CSIS', 'Atlantic Council', 'Jamestown Foundation', 'The New Humanitarian', 'ISS Africa', 'InSight Crime', 'CISA Advisories', 'Just Security'];
const B = ['BBC World', 'Al Jazeera', 'France 24', 'France24 Africa', 'Deutsche Welle', 'Deutsche Welle Asia', 'Guardian World', 'The Guardian', 'NPR World', 'NYT World', 'The Economist', 'Foreign Policy', 'Nikkei Asia', 'Kyiv Independent', 'Kyiv Independent World', 'Defense One', 'Long War Journal', 'War on the Rocks', 'Balkan Insight', 'OC Media', 'Meduza', 'Novaya Gazeta Europe', 'The Diplomat', 'Semafor', 'RFE/RL', 'bne IntelliNews', 'The Conversation', 'Euronews', 'Sky News', 'The Independent', 'CNN World', 'CBS World', 'NBC World', 'ABC News', 'ABC Australia', 'Channel News Asia', 'Straits Times', 'Japan Times', 'Korea Herald', 'Yonhap', 'The Hindu', 'Hindustan Times', 'Le Monde', 'El País', 'Middle East Eye', 'The New Arab', 'Rest of World', 'Global Voices', 'openDemocracy', 'Notes from Poland', 'Daily Maverick', 'Mail & Guardian', 'Breaking Defense', 'Defense News', 'The War Zone', 'Naval News', 'The Cipher Brief', 'The Irrawaddy', 'HumAngle', '+972 Magazine', 'Syria Direct', 'Benar News', 'Small Wars Journal', 'El Faro English', 'The Record', 'BleepingComputer', 'The Hacker News', 'Civil.ge', 'JAMnews', 'RNZ World', 'Mada Masr', 'Prachatai English', 'Colombia Reports', 'Mexico News Daily',
  'CBC World', 'Globe and Mail World', 'Africanews', 'NDTV World', 'Times of India World', 'Indian Express World', 'Interfax Ukraine', 'Emerging Europe', 'Krebs on Security', 'Dark Reading', 'SecurityWeek', 'CyberScoop'];
const C = ['Axios', 'The Hill', 'Politico EU', 'EUobserver', 'CNBC World', 'The Moscow Times', 'The Moscow Times EN', 'Jerusalem Post', 'Times of Israel', 'Al-Monitor', 'Middle East Monitor', 'Dawn', 'Ukrainska Pravda', 'Kyiv Post', 'MercoPress', 'Buenos Aires Times', 'Premium Times', 'Punch', 'Vanguard', 'The Africa Report', 'The East African', 'Nation Africa', 'AllAfrica', 'Bangkok Post', 'The Jakarta Post', 'VnExpress', 'The Kathmandu Post', 'Scroll.in', 'The Print', 'Firstpost', 'Daily Mirror LK', 'Rappler', 'The Daily Star', 'Taipei Times', 'The National', 'Responsible Statecraft', 'The Intercept', 'Newsweek', 'Caracas Chronicles', 'The Tico Times', 'Daily Sabah', 'Al Arabiya', 'Antara News', 'Buenos Aires Herald', 'Philstar', 'Malay Mail', 'Rio Times', 'Infosecurity', 'OilPrice', 'Rigzone', 'FloodList', 'The Watchers'];
const D = ['TASS', 'Global Times', 'Xinhua World', 'Tehran Times', 'Anadolu Agency', 'Anadolu World', 'Arab News', 'Fox World', 'Washington Times', 'Drudge Report', 'teleSUR'];

const GRADE_WEIGHT = { A: 1.0, B: 0.85, C: 0.7, D: 0.5, U: 0.6 };
const MAP = new Map();
for (const n of A) MAP.set(n, 'A');
for (const n of B) MAP.set(n, 'B');
for (const n of C) MAP.set(n, 'C');
for (const n of D) MAP.set(n, 'D');

// GDELT machine-coded articles surface under their publisher domain; treat the
// aggregator itself as C (broad but noisy machine coding).
// Telegram channels graded individually (see src/sources/telegram.js). Raw social
// OSINT → capped low: established monitors C, everything else D (caution).
const TG_GRADE = { 'TG DeepStateUA': 'C', 'TG Militarylandnet': 'C', 'TG wartranslated': 'C', 'TG NOELreports': 'C', 'TG Osinttechnical': 'C', 'TG IntelCrab': 'C', 'TG Faytuks': 'C', 'TG Osint613': 'C', 'TG visegrad24': 'C' };

export function sourceGrade(source, domain) {
  if (!source && !domain) return 'U';
  if (domain === 't.me' || (source && source.startsWith('TG '))) return TG_GRADE[source] || 'D';
  if (source && MAP.has(source)) return MAP.get(source);
  if (source && /GDELT/i.test(source)) return 'C';
  return 'U';
}
export function gradeWeight(grade) {
  return GRADE_WEIGHT[grade] ?? GRADE_WEIGHT.U;
}
export function reliabilityOf(source, domain) {
  return gradeWeight(sourceGrade(source, domain));
}
export const GRADE_LABEL = { A: 'Reliable', B: 'Usually reliable', C: 'Fairly reliable', D: 'State-affiliated / caution', U: 'Unrated' };
