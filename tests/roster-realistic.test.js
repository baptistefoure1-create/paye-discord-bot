import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEMS } from '../src/services/parserEMS.js';

test('tableau EMS réaliste : colonnes vides ne décalent plus la paye', () => {
  const raw = [
    '📂︰alucard-saotome\t[DG/S] Papy Alucard Saotome 🐧\t138020\tDG\t\t\t0\t\t19326168 $\t08/03/2025 - 11:42\tDétails Paie',
    '📂︰tio-war\t..[D] Tio War\t81533\tD\t\t\t0\t\t16804816 $\t12/07/2025 - 08:27\tDétails Paie',
    '📂︰baptiste-fore\t[ADD] Baptiste Fore\t251031\tADD\tS1\t\t0\t12/09/26\t18598313 $\t09/04/2026 - 21:26\tDétails Paie',
    '📂︰leyah-akada\t[MC] Leyah Akada\t239918\tMC\t\t18/10 - 23/10\t0\t17/10/26\t12906975 $\t19/05/2026 - 20:31\tDétails Paie',
    '📂︰weed-crazy\t[EX-ADD] Weed Crazy\t102181\tWDV\tS1\t\t0\t12/07/26\t11500000 $\t08/02/2026 - 18:25\tDétails Paie',
  ].join('\n');
  const out = parseEMS(raw);
  assert.equal(out.employees.length, 5);
  assert.equal(out.employees[0].tablePay, 19326168);
  assert.equal(out.employees[1].tablePay, 16804816);
  assert.equal(out.employees[2].tablePay, 18598313);
  assert.equal(out.employees[3].absencesRaw, '18/10 - 23/10');
  assert.equal(out.employees[4].isWDV, true);
});
