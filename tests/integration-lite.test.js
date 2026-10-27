import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEMS } from '../src/services/parserEMS.js';
import { parseReanimations } from '../src/services/parserReanimations.js';
import { matchReanimationsToEmployees, applyReanimationMatches } from '../src/services/matchingService.js';

test('mini import EMS + réanimations', () => {
  const ems = [
    '📂︰tio-war\t[D] Tio War\t81533\tD\t\t\t0\t\t16804816 $\t12/07/2025 - 08:27\tDétails Paie',
    '📂︰baptiste-fore\t[ADD] Baptiste Fore\t251031\tADD\tS1\t\t0\t12/09/26\t18598313 $\t09/04/2026 - 21:26\tDétails Paie',
    '📂︰khaleb-jonhson\t[𝑨] 𝑲𝒉𝒂𝒍𝒆𝒃 𝑱𝒐𝒏𝒉𝒔𝒐𝒏\t251472\tA\t\t\t0\t\t6794801 $\t18/10/2026 - 23:43\tDétails Paie',
  ].join('\n');
  const rea = [
    '1. Tio War — Réanimations: 291 · Factures encaissées: 0 · Montant factures: $ 0',
    '2. Baptiste Fore — Réanimations: 221 · Factures encaissées: 0 · Montant factures: $ 0',
    '3. Khaleb JONHSON — Réanimations: 40 · Factures encaissées: 0 · Montant factures: $ 0',
  ].join('\n');
  const pe = parseEMS(ems);
  const pr = parseReanimations(rea);
  const matched = matchReanimationsToEmployees(pe.employees, pr.results);
  assert.equal(matched.matches.filter(m => m.employee).length, 3);
  applyReanimationMatches(pe.employees, matched.matches);
  assert.equal(pe.employees.find(e => e.idUnique === '251031').reanimations, 221);
  assert.equal(pe.employees.find(e => e.idUnique === '251472').reanimations, 40);
});
