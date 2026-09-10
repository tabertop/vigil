// Static reference layers — curated, well-known strategic sites and routes.
// These are stable "known-location" datasets (not live feeds): major nuclear
// power sites, military installations, spaceports, maritime chokepoints, and
// principal trade routes. Coordinates are approximate but recognizable. Extend
// freely — the frontend renders any layer listed here.

export const NUCLEAR = [
  { name: 'Zaporizhzhia NPP', lat: 47.51, lon: 34.59, note: 'Largest NPP in Europe · Ukraine' },
  { name: 'Chornobyl Exclusion Zone', lat: 51.39, lon: 30.10, note: 'Decommissioned · Ukraine' },
  { name: 'Kursk NPP', lat: 51.67, lon: 35.60, note: 'Russia' },
  { name: 'Bushehr NPP', lat: 28.83, lon: 50.89, note: 'Iran' },
  { name: 'Natanz Enrichment', lat: 33.72, lon: 51.73, note: 'Enrichment · Iran' },
  { name: 'Fordow Facility', lat: 34.88, lon: 50.99, note: 'Enrichment · Iran' },
  { name: 'Yongbyon Complex', lat: 39.80, lon: 125.75, note: 'North Korea' },
  { name: 'Dimona Reactor', lat: 31.00, lon: 35.14, note: 'Israel' },
  { name: 'Kahuta (KRL)', lat: 33.62, lon: 73.38, note: 'Pakistan' },
  { name: 'Kashiwazaki-Kariwa', lat: 37.43, lon: 138.60, note: 'Japan' },
  { name: 'Fukushima Daiichi', lat: 37.42, lon: 141.03, note: '2011 disaster · Japan' },
  { name: 'Kori NPP', lat: 35.32, lon: 129.29, note: 'South Korea' },
  { name: 'Taishan NPP', lat: 21.80, lon: 112.98, note: 'China' },
  { name: 'Palo Verde', lat: 33.39, lon: -112.86, note: 'Largest US plant' },
  { name: 'Vogtle', lat: 33.14, lon: -81.76, note: 'USA' },
  { name: 'Gravelines', lat: 51.01, lon: 2.14, note: 'France' },
  { name: 'Sellafield', lat: 54.42, lon: -3.50, note: 'Reprocessing · UK' },
  { name: 'Rovno NPP', lat: 51.33, lon: 25.89, note: 'Ukraine' },
  { name: 'Kudankulam', lat: 8.17, lon: 77.71, note: 'India' },
  { name: 'Barakah', lat: 24.00, lon: 52.20, note: 'UAE' },
];

export const MILITARY = [
  { name: 'Ramstein Air Base', lat: 49.44, lon: 7.60, note: 'US/NATO · Germany' },
  { name: 'Al Udeid Air Base', lat: 25.12, lon: 51.32, note: 'US CENTCOM · Qatar' },
  { name: 'Naval Base Guam', lat: 13.43, lon: 144.66, note: 'US Pacific' },
  { name: 'Diego Garcia', lat: -7.31, lon: 72.41, note: 'US/UK · Indian Ocean' },
  { name: 'Camp Humphreys', lat: 36.96, lon: 127.03, note: 'US · South Korea' },
  { name: 'Kadena Air Base', lat: 26.35, lon: 127.77, note: 'US · Okinawa' },
  { name: 'Incirlik Air Base', lat: 37.00, lon: 35.42, note: 'US/NATO · Turkey' },
  { name: 'Naval Station Norfolk', lat: 36.95, lon: -76.33, note: 'Largest naval base · USA' },
  { name: 'Guantanamo Bay', lat: 19.90, lon: -75.11, note: 'US · Cuba' },
  { name: 'Djibouti (Lemonnier)', lat: 11.55, lon: 43.15, note: 'US/multi · Horn of Africa' },
  { name: 'Tartus Naval Base', lat: 34.90, lon: 35.87, note: 'Russia · Syria' },
  { name: 'Khmeimim Air Base', lat: 35.40, lon: 35.95, note: 'Russia · Syria' },
  { name: 'Severomorsk', lat: 69.07, lon: 33.42, note: 'Russia Northern Fleet' },
  { name: 'Yulin Naval Base', lat: 18.23, lon: 109.51, note: 'China · Hainan (subs)' },
  { name: 'Djibouti (PLA Base)', lat: 11.59, lon: 43.06, note: 'China · first overseas base' },
  { name: 'Bagram (former)', lat: 34.95, lon: 69.26, note: 'Afghanistan' },
  { name: 'RAF Akrotiri', lat: 34.59, lon: 32.99, note: 'UK · Cyprus' },
  { name: 'Pearl Harbor', lat: 21.35, lon: -157.95, note: 'US Pacific Fleet' },
  { name: 'Andersen AFB', lat: 13.58, lon: 144.93, note: 'US bombers · Guam' },
  { name: 'Rota Naval Station', lat: 36.62, lon: -6.35, note: 'US/NATO · Spain' },
];

export const SPACEPORTS = [
  { name: 'Kennedy Space Center', lat: 28.57, lon: -80.65, note: 'USA' },
  { name: 'Cape Canaveral SFS', lat: 28.49, lon: -80.57, note: 'USA' },
  { name: 'Vandenberg SFB', lat: 34.74, lon: -120.57, note: 'USA · polar' },
  { name: 'Starbase (Boca Chica)', lat: 25.99, lon: -97.16, note: 'SpaceX · USA' },
  { name: 'Baikonur Cosmodrome', lat: 45.96, lon: 63.31, note: 'Kazakhstan (Russia)' },
  { name: 'Plesetsk Cosmodrome', lat: 62.93, lon: 40.68, note: 'Russia' },
  { name: 'Vostochny Cosmodrome', lat: 51.88, lon: 128.33, note: 'Russia' },
  { name: 'Jiuquan (JSLC)', lat: 40.96, lon: 100.29, note: 'China' },
  { name: 'Wenchang (WSLC)', lat: 19.61, lon: 110.95, note: 'China' },
  { name: 'Xichang (XSLC)', lat: 28.25, lon: 102.03, note: 'China' },
  { name: 'Satish Dhawan (Sriharikota)', lat: 13.72, lon: 80.23, note: 'India' },
  { name: 'Tanegashima', lat: 30.40, lon: 130.97, note: 'Japan' },
  { name: 'Guiana Space Centre', lat: 5.24, lon: -52.77, note: 'ESA · Kourou' },
  { name: 'Sohae (Tongchang-ri)', lat: 39.66, lon: 124.71, note: 'North Korea' },
  { name: 'Semnan Spaceport', lat: 35.23, lon: 53.95, note: 'Iran' },
];

// Principal maritime trade routes as polylines [[lon,lat],...] (great-circle-ish).
export const TRADE_ROUTES = [
  { name: 'Suez–Europe (via Bab-el-Mandeb)', path: [[43.3, 12.6], [43.5, 20], [38, 27], [32.3, 30.6], [30, 33], [20, 35], [5, 37], [-5.6, 35.9]] },
  { name: 'Hormuz–Asia', path: [[56.3, 26.6], [60, 24], [68, 18], [76, 8], [80, 6], [90, 5], [100.4, 2.5], [104, 1.3]] },
  { name: 'Malacca–East Asia', path: [[100.4, 2.5], [104, 1.3], [110, 5], [114, 12], [117, 18], [120, 24], [122, 30], [125, 33]] },
  { name: 'Trans-Pacific', path: [[125, 34], [140, 36], [160, 40], [-170, 44], [-150, 46], [-130, 44], [-122, 37]] },
  { name: 'Trans-Atlantic', path: [[-74, 40.6], [-60, 43], [-40, 47], [-20, 49], [-5, 49], [1.9, 51]] },
  { name: 'Cape Route', path: [[3.4, 6.4], [8, -5], [12, -20], [18.5, -34.4], [30, -35], [43, -20], [56.3, 26.6]] },
  { name: 'Panama Link', path: [[-79.7, 9.1], [-82, 12], [-84, 16], [-90, 20], [-95, 22], [-97.16, 26]] },
];

export function referencePayload() {
  return {
    nuclear: NUCLEAR.map((d) => ({ ...d, layer: 'nuclear' })),
    military: MILITARY.map((d) => ({ ...d, layer: 'military' })),
    spaceports: SPACEPORTS.map((d) => ({ ...d, layer: 'spaceports' })),
    tradeRoutes: TRADE_ROUTES,
  };
}
