// Sanctions exposure reference — OFAC/EU/UN program coverage by country.
// A live OFAC/OpenSanctions API needs a key (and their public endpoints are
// blocked from some egress), so this ships a curated, auditable snapshot of the
// major sanctions programs by jurisdiction — enough to enrich a country dossier
// with "who has sanctioned this place, and how comprehensively." When a key is
// available, src/sources/sanctions.js can override this at ingest.
//
// tier: comprehensive (near-total embargo) · sectoral (targeted sectors) ·
//       targeted (designated persons/entities only)

export const SANCTIONS = {
  RU: { tier: 'comprehensive', programs: ['US OFAC (RUSSIA-EO14024)', 'EU (14th package)', 'UK OFSI', 'Canada', 'Japan', 'Australia'], note: 'Broad financial, energy, tech, and central-bank sanctions since 2022.' },
  IR: { tier: 'comprehensive', programs: ['US OFAC (IRAN)', 'EU', 'UN legacy', 'UK'], note: 'Comprehensive US embargo; nuclear, missile, and IRGC designations.' },
  KP: { tier: 'comprehensive', programs: ['UN Security Council', 'US OFAC (DPRK)', 'EU', 'Japan', 'ROK'], note: 'UN arms embargo; near-total trade and financial isolation.' },
  SY: { tier: 'comprehensive', programs: ['US OFAC (SYRIA)', 'EU', 'UK', 'Arab League (partial)'], note: 'Broad sanctions; partial easing under review post-2024.' },
  CU: { tier: 'comprehensive', programs: ['US OFAC (CUBA)'], note: 'Long-standing US trade embargo.' },
  VE: { tier: 'sectoral', programs: ['US OFAC (VENEZUELA)', 'EU', 'Canada'], note: 'Oil sector and PDVSA; targeted regime officials.' },
  BY: { tier: 'sectoral', programs: ['EU', 'US OFAC (BELARUS)', 'UK', 'Canada'], note: 'Sectoral + Lukashenko-regime and Russia-linkage designations.' },
  MM: { tier: 'sectoral', programs: ['US OFAC (BURMA)', 'EU', 'UK', 'Canada'], note: 'Junta, MOGE, and military conglomerate designations.' },
  AF: { tier: 'targeted', programs: ['UN (Taliban/ISIL)', 'US OFAC'], note: 'Taliban leadership and terror-finance designations.' },
  SD: { tier: 'targeted', programs: ['US OFAC (SUDAN)', 'EU', 'UN (Darfur arms embargo)'], note: 'SAF/RSF-linked entities; Darfur arms embargo.' },
  LY: { tier: 'targeted', programs: ['UN', 'US OFAC (LIBYA)', 'EU'], note: 'Arms embargo; asset freezes on spoilers.' },
  ZW: { tier: 'targeted', programs: ['US OFAC (ZIMBABWE)', 'EU (lapsed/partial)'], note: 'Targeted designations of officials and entities.' },
  ML: { tier: 'targeted', programs: ['UN', 'EU', 'US OFAC'], note: 'Sanctions on actors obstructing the peace process.' },
  CF: { tier: 'targeted', programs: ['UN', 'EU'], note: 'Arms embargo; designated armed-group leaders.' },
  SS: { tier: 'targeted', programs: ['UN', 'US OFAC', 'EU'], note: 'Arms embargo; conflict-actor designations.' },
  ET: { tier: 'targeted', programs: ['US OFAC (EO Ethiopia)'], note: 'Authorities for Tigray-conflict-related designations.' },
  CN: { tier: 'targeted', programs: ['US OFAC (Xinjiang/CMIC)', 'EU (Xinjiang)', 'UK'], note: 'Entity List, CMIC investment ban, human-rights designations.' },
  IQ: { tier: 'targeted', programs: ['US OFAC', 'UN legacy'], note: 'Militia and terror-finance designations.' },
  LB: { tier: 'targeted', programs: ['US OFAC (Hizballah)'], note: 'Hezbollah finance and facilitator designations.' },
  YE: { tier: 'targeted', programs: ['UN', 'US OFAC (Houthi/SDGT)'], note: 'Houthi leadership and finance; arms embargo.' },
  NI: { tier: 'targeted', programs: ['US OFAC (NICARAGUA)', 'EU', 'Canada'], note: 'Regime-official designations.' },
  ER: { tier: 'targeted', programs: ['US OFAC', 'EU (lapsed)'], note: 'Designations tied to the Tigray conflict.' },
};

export function sanctionsFor(iso) {
  return (iso && SANCTIONS[String(iso).toUpperCase()]) || null;
}
export const SANCTION_TIERS = { comprehensive: 3, sectoral: 2, targeted: 1 };
