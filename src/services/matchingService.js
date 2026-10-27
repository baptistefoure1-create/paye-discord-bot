import { normalizeName, similarity } from '../utils/normalize.js';

function tokens(value) {
  return normalizeName(value).split(' ').filter(Boolean);
}

function unorderedKey(value) {
  return [...tokens(value)].sort((a, b) => a.localeCompare(b, 'fr')).join(' ');
}

function tokenOverlap(a, b) {
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

export function smartNameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (unorderedKey(a) === unorderedKey(b)) return 0.995;

  const ta = tokens(a);
  const tb = tokens(b);
  const base = similarity(a, b);
  const overlap = tokenOverlap(a, b);
  let score = Math.max(base, (base * 0.72) + (overlap * 0.28));

  if (ta.length >= 2 && tb.length >= 2) {
    const first = similarity(ta[0], tb[0]);
    const last = similarity(ta[ta.length - 1], tb[tb.length - 1]);
    if (last >= 0.99 && first >= 0.72) score = Math.max(score, 0.90 + (first * 0.08));
    if (first >= 0.99 && last >= 0.72) score = Math.max(score, 0.90 + (last * 0.08));
  }

  return Math.min(1, score);
}

// V0.2.9 : les correspondances sûres sont automatiques.
// Les vrais anciens noms / wipes / cas ambigus restent à valider dans l'interface Étape 3.
export function matchReanimationsToEmployees(employees, reanimations) {
  const matches = [];
  const anomalies = [];
  const usedEmployeeIds = new Set();

  for (const rea of reanimations) {
    const normalized = normalizeName(rea.name);
    const exact = employees.filter((e) => !e.isWDV && normalizeName(e.name) === normalized);

    if (exact.length === 1) {
      const employee = exact[0];
      if (usedEmployeeIds.has(employee.idUnique)) {
        anomalies.push(`BLOQUANT : plusieurs lignes de réanimations correspondent à ${employee.name} (ID ${employee.idUnique}).`);
      }
      usedEmployeeIds.add(employee.idUnique);
      matches.push({ rea, employee, confidence: 1, ambiguous: false, exact: true });
      continue;
    }

    if (exact.length > 1) {
      matches.push({
        rea,
        employee: null,
        confidence: 1,
        ambiguous: true,
        orphan: true,
        candidates: exact.slice(0, 8).map((employee) => ({ employee, score: 1 })),
      });
      continue;
    }

    const candidates = employees
      .filter((e) => !e.isWDV)
      .map((employee) => ({ employee, score: smartNameSimilarity(rea.name, employee.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const best = candidates[0];
    const second = candidates[1];
    const gap = best ? best.score - (second?.score || 0) : 0;
    const safeMatch = Boolean(best && (
      (best.score >= 0.94 && gap >= 0.12)
      || (best.score >= 0.985 && gap >= 0.05)
    ));

    if (safeMatch && !usedEmployeeIds.has(best.employee.idUnique)) {
      usedEmployeeIds.add(best.employee.idUnique);
      matches.push({
        rea,
        employee: best.employee,
        confidence: best.score,
        ambiguous: false,
        exact: false,
        fuzzyAutomatic: true,
        candidates,
      });
      continue;
    }

    matches.push({
      rea,
      employee: null,
      confidence: best?.score || 0,
      ambiguous: true,
      orphan: true,
      candidates,
    });
  }

  return { matches, anomalies };
}

export function applyReanimationMatches(employees, matches) {
  for (const employee of employees) employee.reanimations = 0;
  for (const match of matches) {
    if (!match.employee) continue;
    match.employee.reanimations = Number(match.employee.reanimations || 0) + Number(match.rea.reanimations || 0);
  }
}
