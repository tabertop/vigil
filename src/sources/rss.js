// RSS/Atom adapter — pulls real, free, keyless world-news feeds and folds them
// into the same unified model as GDELT. This is what turns VIGIL from a
// single-source monitor into a multi-source one (roadmap step 2).
//
// It produces two things from each ingest:
//   • wire records   — the article list (title, url, domain, country, time)
//   • country signals — coarse geo points at a country centroid, sized by how
//                       many articles mention that country (source fusion on the
//                       map, marked `precise:false` so the UI can style them).
//
// Zero dependencies: feeds are fetched with the built-in `fetch` and parsed with
// a small tolerant regex parser (RSS 2.0 <item> and Atom <entry> both handled).
// If every feed fails (offline/blocked egress) it falls back to a bundled sample.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tagCountries } from '../data/countries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Free, keyless feeds. Humanitarian + wire mix, weighted toward crisis coverage.
// All are public RSS/Atom (no key). Each is fetched independently and falls back
// on its own — one feed being blocked never sinks the others.
export const FEEDS = [
  // Humanitarian / institutional
  { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', domain: 'reliefweb.int' },
  { name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', domain: 'news.un.org' },
  { name: 'Crisis Group', url: 'https://www.crisisgroup.org/rss.xml', domain: 'crisisgroup.org' },
  // International wire
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', domain: 'aljazeera.com' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', domain: 'bbc.co.uk' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', domain: 'france24.com' },
  { name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-world', domain: 'dw.com' },
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', domain: 'theguardian.com' },
  // Regional desks — broaden geographic coverage
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', domain: 'npr.org' },
  { name: 'CBC World', url: 'https://www.cbc.ca/webfeed/rss/rss-world', domain: 'cbc.ca' },
  { name: 'The Moscow Times', url: 'https://www.themoscowtimes.com/rss/news', domain: 'themoscowtimes.com' },
  { name: 'The Diplomat', url: 'https://thediplomat.com/feed/', domain: 'thediplomat.com' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed', domain: 'scmp.com' },
  { name: 'Channel News Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', domain: 'channelnewsasia.com' },
  { name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedsheadlines.aspx', domain: 'jpost.com' },
  { name: 'Anadolu Agency', url: 'https://www.aa.com.tr/en/rss/default?cat=world', domain: 'aa.com.tr' },
  { name: 'AllAfrica', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', domain: 'allafrica.com' },
  { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', domain: 'bellingcat.com' },
  // US desks (world/international/politics). AP has no public RSS; WaPo's is
  // paywall-truncated — both omitted. Drudge has no official feed; the entry
  // below is a public third-party mirror (may break independently of Drudge).
  { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', domain: 'nytimes.com' },
  { name: 'Axios', url: 'https://api.axios.com/feed/', domain: 'axios.com' },
  { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml', domain: 'politico.com' },
  { name: 'The Hill', url: 'https://thehill.com/policy/international/feed/', domain: 'thehill.com' },
  { name: 'Fox World', url: 'https://moxie.foxnews.com/google-publisher/world.xml', domain: 'foxnews.com' },
  { name: 'NBC World', url: 'https://feeds.nbcnews.com/nbcnews/public/world', domain: 'nbcnews.com' },
  { name: 'CBS World', url: 'https://www.cbsnews.com/latest/rss/world', domain: 'cbsnews.com' },
  { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines', domain: 'abcnews.go.com' },
  { name: 'Newsweek', url: 'https://www.newsweek.com/rss', domain: 'newsweek.com' },
  { name: 'Washington Times', url: 'https://www.washingtontimes.com/rss/headlines/news/world/', domain: 'washingtontimes.com' },
  { name: 'Drudge Report', url: 'https://feedpress.me/drudgereportfeed', domain: 'drudgereport.com' },
  // More international desks
  { name: 'CNN World', url: 'http://rss.cnn.com/rss/edition_world.rss', domain: 'cnn.com' },
  { name: 'The Independent', url: 'https://www.independent.co.uk/news/world/rss', domain: 'independent.co.uk' },
  { name: 'Euronews', url: 'https://www.euronews.com/rss?level=theme&name=news', domain: 'euronews.com' },
  { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml', domain: 'news.sky.com' },
  { name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', domain: 'abc.net.au' },
  { name: 'RFI', url: 'https://www.rfi.fr/en/rss', domain: 'rfi.fr' },
  { name: 'Straits Times', url: 'https://www.straitstimes.com/news/world/rss.xml', domain: 'straitstimes.com' },
  // More regional + defense/security desks
  { name: 'Le Monde', url: 'https://www.lemonde.fr/en/rss/une.xml', domain: 'lemonde.fr' },
  { name: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada', domain: 'elpais.com' },
  { name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', domain: 'thehindu.com' },
  { name: 'Kyiv Independent', url: 'https://kyivindependent.com/feed/rss/', domain: 'kyivindependent.com' },
  { name: 'Kyiv Post', url: 'https://www.kyivpost.com/feed', domain: 'kyivpost.com' },
  { name: 'Middle East Monitor', url: 'https://www.middleeastmonitor.com/feed/', domain: 'middleeastmonitor.com' },
  { name: 'Al-Monitor', url: 'https://www.al-monitor.com/rss', domain: 'al-monitor.com' },
  { name: 'Defense One', url: 'https://www.defenseone.com/rss/all/', domain: 'defenseone.com' },
  // Broader regional + security + economic desks
  { name: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar', domain: 'asia.nikkei.com' },
  { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/', domain: 'japantimes.co.jp' },
  { name: 'Dawn', url: 'https://www.dawn.com/feeds/home', domain: 'dawn.com' },
  { name: 'Meduza', url: 'https://meduza.io/rss/en/all', domain: 'meduza.io' },
  { name: 'TASS', url: 'https://tass.com/rss/v2.xml', domain: 'tass.com' },
  { name: 'Politico EU', url: 'https://www.politico.eu/feed/', domain: 'politico.eu' },
  { name: 'EUobserver', url: 'https://euobserver.com/rss', domain: 'euobserver.com' },
  { name: 'Balkan Insight', url: 'https://balkaninsight.com/feed/', domain: 'balkaninsight.com' },
  { name: 'OC Media', url: 'https://oc-media.org/feed/', domain: 'oc-media.org' },
  { name: 'MercoPress', url: 'https://en.mercopress.com/rss', domain: 'mercopress.com' },
  { name: 'Daily Maverick', url: 'https://www.dailymaverick.co.za/dmrss/', domain: 'dailymaverick.co.za' },
  { name: 'Long War Journal', url: 'https://www.longwarjournal.org/feed', domain: 'longwarjournal.org' },
  { name: 'CNBC World', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', domain: 'cnbc.com' },
  // Further regional + analysis desks
  { name: 'Global Times', url: 'https://www.globaltimes.cn/rss/outbrain.xml', domain: 'globaltimes.cn' },
  { name: 'Arab News', url: 'https://www.arabnews.com/rss.xml', domain: 'arabnews.com' },
  { name: 'Ukrainska Pravda', url: 'https://www.pravda.com.ua/eng/rss/', domain: 'pravda.com.ua' },
  { name: 'Premium Times', url: 'https://www.premiumtimesng.com/feed', domain: 'premiumtimesng.com' },
  { name: 'Buenos Aires Times', url: 'https://www.batimes.com.ar/feed', domain: 'batimes.com.ar' },
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', domain: 'warontherocks.com' },
  { name: 'Responsible Statecraft', url: 'https://responsiblestatecraft.org/feed/', domain: 'responsiblestatecraft.org' },
  { name: 'Global Voices', url: 'https://globalvoices.org/feed/', domain: 'globalvoices.org' },
  { name: 'Rest of World', url: 'https://restofworld.org/feed/', domain: 'restofworld.org' },
  { name: 'The Intercept', url: 'https://theintercept.com/feed/?rss', domain: 'theintercept.com' },
  // Still more regional desks
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml', domain: 'hindustantimes.com' },
  { name: 'Korea Herald', url: 'https://www.koreaherald.com/rss/newsAll', domain: 'koreaherald.com' },
  { name: 'Bangkok Post', url: 'https://www.bangkokpost.com/rss/data/topstories.xml', domain: 'bangkokpost.com' },
  { name: 'The Africa Report', url: 'https://www.theafricareport.com/feed/', domain: 'theafricareport.com' },
  { name: 'Novaya Gazeta Europe', url: 'https://novayagazeta.eu/feed/rss?lang=en', domain: 'novayagazeta.eu' },
  { name: 'Notes from Poland', url: 'https://notesfrompoland.com/feed/', domain: 'notesfrompoland.com' },
  { name: 'Semafor', url: 'https://www.semafor.com/rss.xml', domain: 'semafor.com' },
  // Region-local desks — a truer worldview (Africa, Asia, Middle East)
  { name: 'Tehran Times', url: 'https://www.tehrantimes.com/rss', domain: 'tehrantimes.com' },
  { name: 'The National', url: 'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml', domain: 'thenationalnews.com' },
  { name: 'Taipei Times', url: 'https://www.taipeitimes.com/xml/index.rss', domain: 'taipeitimes.com' },
  { name: 'Yonhap', url: 'https://en.yna.co.kr/RSS/news.xml', domain: 'yna.co.kr' },
  { name: 'Rappler', url: 'https://www.rappler.com/feed/', domain: 'rappler.com' },
  { name: 'The Daily Star', url: 'https://www.thedailystar.net/frontpage/rss.xml', domain: 'thedailystar.net' },
  { name: 'Punch', url: 'https://punchng.com/feed/', domain: 'punchng.com' },
  { name: 'Vanguard', url: 'https://www.vanguardngr.com/feed/', domain: 'vanguardngr.com' },
  // Additional regional / local outlets — a wider "true worldview"
  { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', domain: 'timesofisrael.com' },
  { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss', domain: 'middleeasteye.net' },
  { name: 'The New Arab', url: 'https://www.newarab.com/rss', domain: 'newarab.com' },
  { name: 'Daily Sabah', url: 'https://www.dailysabah.com/rssFeed/homepage', domain: 'dailysabah.com' },
  { name: 'Al Arabiya', url: 'https://english.alarabiya.net/tools/rss', domain: 'alarabiya.net' },
  { name: 'Mail & Guardian', url: 'https://mg.co.za/feed/', domain: 'mg.co.za' },
  { name: 'The East African', url: 'https://www.theeastafrican.co.ke/rss', domain: 'theeastafrican.co.ke' },
  { name: 'Nation Africa', url: 'https://nation.africa/kenya/rss', domain: 'nation.africa' },
  { name: 'The Jakarta Post', url: 'https://www.thejakartapost.com/rss', domain: 'thejakartapost.com' },
  { name: 'VnExpress', url: 'https://e.vnexpress.net/rss/news.rss', domain: 'vnexpress.net' },
  { name: 'The Kathmandu Post', url: 'https://kathmandupost.com/rss', domain: 'kathmandupost.com' },
  { name: 'Scroll.in', url: 'https://scroll.in/feeds/all.rss', domain: 'scroll.in' },
  { name: 'Daily Mirror LK', url: 'https://www.dailymirror.lk/rss/breaking-news', domain: 'dailymirror.lk' },
  { name: 'RFE/RL', url: 'https://www.rferl.org/api/zrqiteuuir', domain: 'rferl.org' },
  { name: 'bne IntelliNews', url: 'https://www.intellinews.com/feed', domain: 'intellinews.com' },
  { name: 'teleSUR', url: 'https://www.telesurenglish.net/rss/Rss.xml', domain: 'telesurenglish.net' },
  { name: 'Caracas Chronicles', url: 'https://www.caracaschronicles.com/feed/', domain: 'caracaschronicles.com' },
  { name: 'The Tico Times', url: 'https://ticotimes.net/feed', domain: 'ticotimes.net' },
  // Further international wires & agencies
  { name: 'AP Top News', url: 'https://feeds.apnews.com/rss/apf-topnews', domain: 'apnews.com' },
  { name: 'Reuters World', url: 'https://www.reutersagency.com/feed/?best-topics=world&post_type=best', domain: 'reuters.com' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/international/rss', domain: 'theguardian.com' },
  { name: 'Deutsche Welle Asia', url: 'https://rss.dw.com/rdf/rss-en-asia', domain: 'dw.com' },
  { name: 'France24 Africa', url: 'https://www.france24.com/en/africa/rss', domain: 'france24.com' },
  { name: 'The Economist', url: 'https://www.economist.com/international/rss.xml', domain: 'economist.com' },
  { name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/', domain: 'foreignpolicy.com' },
  { name: 'The Conversation', url: 'https://theconversation.com/global/articles.atom', domain: 'theconversation.com' },
  { name: 'openDemocracy', url: 'https://www.opendemocracy.net/en/rss/', domain: 'opendemocracy.net' },
  { name: 'ISW', url: 'https://www.understandingwar.org/backgrounder/feed', domain: 'understandingwar.org' },
  { name: 'ACLED', url: 'https://acleddata.com/feed/', domain: 'acleddata.com' },
  { name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', domain: 'who.int' },
  { name: 'UNHCR', url: 'https://www.unhcr.org/rss/news.xml', domain: 'unhcr.org' },
  { name: 'OCHA', url: 'https://www.unocha.org/rss.xml', domain: 'unocha.org' },
  { name: 'The Moscow Times EN', url: 'https://www.themoscowtimes.com/rss/news', domain: 'themoscowtimes.com' },
  { name: 'Kyiv Independent World', url: 'https://kyivindependent.com/feed/', domain: 'kyivindependent.com' },
  { name: 'The Print', url: 'https://theprint.in/feed/', domain: 'theprint.in' },
  { name: 'Firstpost', url: 'https://www.firstpost.com/rss/world.xml', domain: 'firstpost.com' },
  { name: 'Anadolu World', url: 'https://www.aa.com.tr/en/rss/default?cat=world', domain: 'aa.com.tr' },
  { name: 'Xinhua World', url: 'http://www.xinhuanet.com/english/rss/worldrss.xml', domain: 'xinhuanet.com' },
  // Defense / security trade press & think tanks
  { name: 'Breaking Defense', url: 'https://breakingdefense.com/feed/', domain: 'breakingdefense.com' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', domain: 'defensenews.com' },
  { name: 'The War Zone', url: 'https://www.twz.com/feed', domain: 'twz.com' },
  { name: 'Naval News', url: 'https://www.navalnews.com/feed/', domain: 'navalnews.com' },
  { name: 'The Cipher Brief', url: 'https://www.thecipherbrief.com/feed', domain: 'thecipherbrief.com' },
  { name: 'Atlantic Council', url: 'https://www.atlanticcouncil.org/feed/', domain: 'atlanticcouncil.org' },
  { name: 'CSIS', url: 'https://www.csis.org/analysis/feed', domain: 'csis.org' },
  { name: 'Jamestown Foundation', url: 'https://jamestown.org/feed/', domain: 'jamestown.org' },
  { name: 'Small Wars Journal', url: 'https://smallwarsjournal.com/rss.xml', domain: 'smallwarsjournal.com' },
  // Regional security & humanitarian
  { name: 'InSight Crime', url: 'https://insightcrime.org/feed/', domain: 'insightcrime.org' },
  { name: 'The Irrawaddy', url: 'https://www.irrawaddy.com/feed', domain: 'irrawaddy.com' },
  { name: 'HumAngle', url: 'https://humanglemedia.com/feed/', domain: 'humanglemedia.com' },
  { name: 'The New Humanitarian', url: 'https://www.thenewhumanitarian.org/rss/all.xml', domain: 'thenewhumanitarian.org' },
  { name: '+972 Magazine', url: 'https://www.972mag.com/feed/', domain: '972mag.com' },
  { name: 'Syria Direct', url: 'https://syriadirect.org/feed/', domain: 'syriadirect.org' },
  { name: 'ISS Africa', url: 'https://issafrica.org/rss/recent-publications', domain: 'issafrica.org' },
  { name: 'Benar News', url: 'https://www.benarnews.org/english/rss2.xml', domain: 'benarnews.org' },
  { name: 'El Faro English', url: 'https://elfaro.net/en/rss/', domain: 'elfaro.net' },
  { name: 'Emerald Intelligence', url: 'https://theintelbrief.com/feed/', domain: 'theintelbrief.com' },
  // Cyber
  { name: 'CISA Advisories', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', domain: 'cisa.gov' },
  { name: 'The Record', url: 'https://therecord.media/feed', domain: 'therecord.media' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', domain: 'bleepingcomputer.com' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', domain: 'thehackernews.com' },
  // Caucasus / Central Asia
  { name: 'Civil.ge', url: 'https://civil.ge/feed', domain: 'civil.ge' },
  { name: 'JAMnews', url: 'https://jam-news.net/feed/', domain: 'jam-news.net' },
  // South & Southeast Asia / Pacific
  { name: 'Prachatai English', url: 'https://prachataienglish.com/rss.xml', domain: 'prachataienglish.com' },
  { name: 'RNZ World', url: 'https://www.rnz.co.nz/rss/world.xml', domain: 'rnz.co.nz' },
  // Middle East / Africa
  { name: 'Mada Masr', url: 'https://www.madamasr.com/en/feed/', domain: 'madamasr.com' },
  // Latin America
  { name: 'Colombia Reports', url: 'https://colombiareports.com/feed/', domain: 'colombiareports.com' },
  { name: 'Mexico News Daily', url: 'https://mexiconewsdaily.com/feed/', domain: 'mexiconewsdaily.com' },
  // Law / security analysis
  { name: 'Just Security', url: 'https://www.justsecurity.org/feed/', domain: 'justsecurity.org' },
  // --- research-verified batch (probed live) ---
  // International wires / national outlets
  { name: 'CBC World', url: 'https://www.cbc.ca/webfeed/rss/rss-world', domain: 'cbc.ca' },
  { name: 'Globe and Mail World', url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/', domain: 'theglobeandmail.com' },
  { name: 'Africanews', url: 'https://www.africanews.com/feed/rss', domain: 'africanews.com' },
  { name: 'NDTV World', url: 'https://feeds.feedburner.com/ndtvnews-world-news', domain: 'ndtv.com' },
  { name: 'Times of India World', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', domain: 'indiatimes.com' },
  { name: 'Indian Express World', url: 'https://indianexpress.com/section/world/feed/', domain: 'indianexpress.com' },
  { name: 'Interfax Ukraine', url: 'https://en.interfax.com.ua/news/last.rss', domain: 'interfax.com.ua' },
  { name: 'Emerging Europe', url: 'https://emerging-europe.com/feed/', domain: 'emerging-europe.com' },
  { name: 'Antara News', url: 'https://en.antaranews.com/rss/news.xml', domain: 'antaranews.com' },
  { name: 'Buenos Aires Herald', url: 'https://buenosairesherald.com/feed', domain: 'buenosairesherald.com' },
  { name: 'Philstar', url: 'https://www.philstar.com/rss/headlines', domain: 'philstar.com' },
  { name: 'Malay Mail', url: 'https://www.malaymail.com/feed/rss/world', domain: 'malaymail.com' },
  { name: 'Rio Times', url: 'https://www.riotimesonline.com/feed/', domain: 'riotimesonline.com' },
  // Cyber
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', domain: 'krebsonsecurity.com' },
  { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', domain: 'darkreading.com' },
  { name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/', domain: 'securityweek.com' },
  { name: 'CyberScoop', url: 'https://cyberscoop.com/feed/', domain: 'cyberscoop.com' },
  { name: 'Infosecurity', url: 'https://www.infosecurity-magazine.com/rss/news/', domain: 'infosecurity-magazine.com' },
  // Energy / commodities
  { name: 'OilPrice', url: 'https://oilprice.com/rss/main', domain: 'oilprice.com' },
  { name: 'Rigzone', url: 'https://www.rigzone.com/news/rss/rigzone_latest.aspx', domain: 'rigzone.com' },
  // Disasters / hazards
  { name: 'FloodList', url: 'https://floodlist.com/feed', domain: 'floodlist.com' },
  { name: 'The Watchers', url: 'https://watchers.news/feed/', domain: 'watchers.news' },
];

// ---- tiny, tolerant feed parser (no XML dependency) ----

function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  // first <name ...>...</name> — captures inner text (CDATA-safe via decode)
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function linkOf(block) {
  // RSS: <link>URL</link>   Atom: <link href="URL" rel="alternate"/>
  const rss = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decode(rss[1]);
  const atom = block.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  return atom ? atom[1] : '';
}

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    const url = linkOf(b);
    if (!title || !url) continue;
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const summary = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    out.push({ title, url, when, summary });
  }
  return out;
}

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function domainOf(url, fallback) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return fallback || ''; }
}

// A browser-ish UA — several outlets 403 non-browser agents (a common cause of
// feeds "dropping" between cycles). Retries once with a longer timeout so slow
// or briefly-unavailable feeds still make it into the run.
// Use a standard browser UA — many outlets (Cloudflare-fronted) 403 a bot-style UA.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
async function getOnce(url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}
async function getText(url) {
  try { return await getOnce(url, 15000); }
  catch { return await getOnce(url, 22000); } // one retry, longer timeout
}

// ---- normalize one feed's parsed items into unified wire records ----

function toWire(items, feed) {
  const now = Date.now();
  return items
    .map((it) => {
      const t = Date.parse(it.when);
      const publishedAt = isNaN(t) ? now : t;
      const tags = tagCountries(it.title + ' ' + it.summary);
      return {
        id: hashId('rss:' + it.url),
        title: it.title,
        url: it.url,
        domain: domainOf(it.url, feed.domain),
        country: tags[0] ? tags[0].country.name : '',
        countries: tags.map((x) => x.country.iso), // all mentioned, for the index
        publishedAt,
        source: feed.name,
      };
    })
    .filter((r) => r.title && r.url);
}

// Aggregate country mentions across all wire records → coarse map signals.
// Each signal carries `time` = the most recent contributing article, so the
// server can filter it by time window like any other event.
function toCountrySignals(wire) {
  const now = Date.now();
  const acc = new Map(); // iso -> { country, count, time }
  for (const r of wire) {
    const tags = tagCountries(r.title + ' ' + (r.country || ''));
    for (const { country, count } of tags) {
      const cur = acc.get(country.iso);
      if (cur) { cur.count += count; cur.time = Math.max(cur.time, r.publishedAt || 0); }
      else acc.set(country.iso, { country, count, time: r.publishedAt || now });
    }
  }
  return [...acc.values()].map(({ country, count, time }) => ({
    id: hashId('rss-geo:' + country.iso),
    lat: country.lat,
    lon: country.lon,
    place: country.name,
    count,
    intensity: Math.min(1, count / 12),
    type: 'conflict-signal',
    source: 'RSS (multi-feed)',
    precise: false, // country-centroid, not a precise incident location
    time,           // freshest contributing report
    ingestedAt: now,
  }));
}

// ---- public fetcher (live, with graceful fixture fallback) ----

// Fetch in bounded batches, not all ~150 feeds at once — 150 concurrent HTTPS
// requests + buffered XML spikes memory and sockets and OOM-kills a small (512MB)
// instance mid-ingest. Batching keeps peak memory flat at a small cost in latency.
const RSS_CONCURRENCY = 12;
async function fetchInBatches(feeds, limit) {
  const out = [];
  for (let i = 0; i < feeds.length; i += limit) {
    const batch = feeds.slice(i, i + limit);
    const r = await Promise.allSettled(batch.map((f) => getText(f.url).then((xml) => ({ feed: f, xml }))));
    out.push(...r);
  }
  return out;
}

export async function fetchRss() {
  const results = await fetchInBatches(FEEDS, RSS_CONCURRENCY);
  const wire = [];
  const sources = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const items = parseFeed(r.value.xml);
    const recs = toWire(items, r.value.feed);
    if (recs.length) {
      wire.push(...recs);
      sources.push(r.value.feed.name);
    }
  }

  if (!wire.length) {
    // every feed failed — fall back to the bundled sample so the app still runs
    try {
      const sample = JSON.parse(await readFile(join(__dirname, '..', 'fixtures', 'rss.json'), 'utf8'));
      const recs = toWire(sample, { name: 'Sample Wire', domain: 'sample.local' });
      return { wire: recs, geo: toCountrySignals(recs), live: false, sources: ['sample'] };
    } catch {
      return { wire: [], geo: [], live: false, sources: [] };
    }
  }

  wire.sort((a, b) => b.publishedAt - a.publishedAt);
  return { wire, geo: toCountrySignals(wire), live: true, sources };
}
