// Intelligence report generation — turns an analyst case file into a finished,
// citable product. For each entity pinned to the case it pulls the live dossier
// (assessment, confidence, drivers, key reports) and the forecast, then assembles
// a structured report with a classification header, per-entity sections, the
// analyst's own notes, and a consolidated source appendix graded by reliability.
// Deterministic; every claim traces to a graded source.

import { buildDossier } from './dossier.js';
import { computeForecast } from './forecast.js';
import { sourceGrade, GRADE_LABEL } from '../data/sources.js';

export function buildReport(caseObj, { events, wire, index, history = [], author } = {}) {
  const fc = computeForecast(history, { horizonH: 72 });
  const sourceTally = new Map();
  const entities = (caseObj.entities || []).map((ent) => {
    const d = buildDossier({ iso: ent.iso, place: ent.name }, { events, wire, index });
    for (const a of d.articles || []) { const g = a.grade || sourceGrade(a.source, a.domain); const cur = sourceTally.get(a.source) || { source: a.source, grade: g, count: 0 }; cur.count++; sourceTally.set(a.source, cur); }
    const f = ent.iso ? fc.byIso[ent.iso] : null;
    return {
      name: d.name, iso: d.iso, note: ent.note || '',
      score: d.score, tier: d.tier, confidence: d.confidence,
      assessment: d.assessment,
      drivers: (d.drivers || []).slice(0, 5).map((x) => x.label),
      forecast: f ? { momentumPerDay: f.momentumPerDay, projection: f.projection, projectedTier: f.projectedTier, probEscalation: f.probEscalation, anomalyZ: f.anomalyZ } : null,
      sanctions: d.sanctions || null,
      keyReports: (d.articles || []).slice(0, 6).map((a) => ({ title: a.title, source: a.source, grade: a.grade || sourceGrade(a.source, a.domain), url: a.url, publishedAt: a.publishedAt })),
    };
  });
  const sources = [...sourceTally.values()].sort((a, b) => (a.grade || 'U').localeCompare(b.grade || 'U') || b.count - a.count)
    .map((s) => ({ ...s, gradeLabel: GRADE_LABEL[s.grade] }));

  // executive summary: highest-scoring entities + any escalating
  const ranked = [...entities].sort((a, b) => (b.score || 0) - (a.score || 0));
  const crit = ranked.filter((e) => e.tier === 'Critical').map((e) => e.name);
  const rising = entities.filter((e) => e.forecast && e.forecast.probEscalation >= 40).map((e) => e.name);
  const execSummary =
    `This assessment covers ${entities.length} ${entities.length === 1 ? 'entity' : 'entities'}. ` +
    (crit.length ? `${crit.join(', ')} ${crit.length === 1 ? 'is' : 'are'} assessed at CRITICAL. ` : '') +
    (rising.length ? `Elevated escalation risk over the next 72h: ${rising.join(', ')}. ` : '') +
    (ranked[0] ? `Highest instability: ${ranked[0].name} (${ranked[0].score}/100).` : '');

  return {
    title: caseObj.title || 'Intelligence Assessment',
    classification: caseObj.classification || 'UNCLASSIFIED // OSINT',
    generatedAt: new Date().toISOString(),
    generatedBy: author || 'analyst',
    caseId: caseObj.id,
    execSummary,
    analystNotes: caseObj.notes || '',
    entities,
    sources,
  };
}
