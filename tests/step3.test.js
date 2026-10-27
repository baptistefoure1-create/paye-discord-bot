import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReanimationsToEmployees, applyReanimationMatches } from '../src/services/matchingService.js';

test('étape 3 : une petite variation normalisée se rapproche automatiquement', () => {
  const employees = [{ idUnique: '10', name: 'Zakaria El Mkhntr', grade: 'A', isWDV: false }];
  const reas = [{ name: 'zakaria el mkhntr', reanimations: 145 }];
  const out = matchReanimationsToEmployees(employees, reas);
  assert.equal(out.matches[0].employee.idUnique, '10');
  assert.equal(out.matches[0].ambiguous, false);
});

test('étape 3 : un ancien nom/orphelin n’est plus attribué automatiquement', () => {
  const employees = [
    { idUnique: '247144', name: 'Simonee Babidi', grade: 'M', isWDV: false },
    { idUnique: '94192', name: 'Kelly Guzman', grade: 'A', isWDV: false },
  ];
  const reas = [{ name: 'Simonee Gusman', reanimations: 38 }];
  const out = matchReanimationsToEmployees(employees, reas);
  assert.equal(out.matches[0].employee, null);
  assert.equal(out.matches[0].ambiguous, true);
  assert.equal(out.matches[0].orphan, true);
  assert.equal(out.matches[0].candidates[0].employee.name, 'Simonee Babidi');
});

test('plusieurs anciens noms liés au même EMS additionnent les réanimations', () => {
  const employee = { idUnique: '1', name: 'Test EMS', grade: 'M', isWDV: false };
  const matches = [
    { rea: { reanimations: 20 }, employee },
    { rea: { reanimations: 30 }, employee },
  ];
  applyReanimationMatches([employee], matches);
  assert.equal(employee.reanimations, 50);
});
