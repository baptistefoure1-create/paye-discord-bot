import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEMS } from '../src/services/parserEMS.js';

test('parse une ligne EMS tabulée', () => {
  const raw = `📂︰baptiste-fore\t[ADD] Baptiste Fore\t251031\tADD\tS1\t\t0\t12/09/26\t18598313 $\t09/04/2026 - 21:26\tDétails Paie`;
  const out = parseEMS(raw);
  assert.equal(out.employees.length, 1);
  assert.equal(out.employees[0].name, 'Baptiste Fore');
  assert.equal(out.employees[0].grade, 'ADD');
  assert.equal(out.employees[0].tablePay, 18598313);
  assert.ok(out.employees[0].infoTokens.includes('S1'));
});
