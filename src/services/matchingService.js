import { normalizeName, similarity } from '../utils/normalize.js';

// V0.2 : on reproduit beaucoup plus fidèlement l'étape 3 de Pillbox.
// Une correspondance exacte après normalisation (accents/casse/tirets) est automatique.
// Un nom de réanimation réellement "orphelin" n'est PLUS attribué automatiquement
// par fuzzy matching : on propose seulement des suggestions au gestionnaire.
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
        candidates: exact.slice(0, 5).map((employee) => ({ employee, score: 1 })),
      });
      continue;
    }

    const candidates = employees
      .filter((e) => !e.isWDV)
      .map((employee) => ({ employee, score: similarity(rea.name, employee.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // Ce n'est pas une erreur : cela peut être un ancien nom, un wipe ou quelqu'un qui n'est plus EMS.
    matches.push({
      rea,
      employee: null,
      confidence: candidates[0]?.score || 0,
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
