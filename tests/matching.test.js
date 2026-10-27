import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from '../src/utils/normalize.js';
import { matchReanimationsToEmployees } from '../src/services/matchingService.js';

test('normalise les lettres mathématiques du Roster', () => {
  assert.equal(normalizeName('𝑲𝒉𝒂𝒍𝒆𝒃 𝑱𝒐𝒏𝒉𝒔𝒐𝒏'), 'khaleb jonhson');
});

test('rapproche Khaleb en écriture stylisée', () => {
  const employees = [{ idUnique: '251472', name: '𝑲𝒉𝒂𝒍𝒆𝒃 𝑱𝒐𝒏𝒉𝒔𝒐𝒏', grade: 'A' }];
  const reas = [{ name: 'Khaleb JONHSON', reanimations: 40 }];
  const out = matchReanimationsToEmployees(employees, reas);
  assert.equal(out.matches[0].employee.idUnique, '251472');
});
