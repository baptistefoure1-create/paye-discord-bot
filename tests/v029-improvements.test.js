import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReanimationsToEmployees } from '../src/services/matchingService.js';
import { getALevel, setALevel, incrementALevel } from '../src/services/warningService.js';

test('V0.2.9 : un prénom/nom inversé est reconnu automatiquement', () => {
  const employees = [{ idUnique: '1', name: 'Baptiste Fore', grade: 'ADD', isWDV: false }];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Fore Baptiste', reanimations: 70 }]);
  assert.equal(out.matches[0].employee?.idUnique, '1');
  assert.equal(out.matches[0].ambiguous, false);
});

test('V0.2.9 : une petite faute évidente peut être reconnue automatiquement', () => {
  const employees = [
    { idUnique: '1', name: 'Baptiste Fore', grade: 'ADD', isWDV: false },
    { idUnique: '2', name: 'Pablo O Connor', grade: 'M', isWDV: false },
  ];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Baptiste Foure', reanimations: 70 }]);
  assert.equal(out.matches[0].employee?.idUnique, '1');
  assert.equal(out.matches[0].ambiguous, false);
});

test('V0.2.9 : un ancien nom ambigu reste à valider', () => {
  const employees = [
    { idUnique: '247144', name: 'Simonee Babidi', grade: 'M', isWDV: false },
    { idUnique: '94192', name: 'Kelly Guzman', grade: 'A', isWDV: false },
  ];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Simonee Gusman', reanimations: 38 }]);
  assert.equal(out.matches[0].employee, null);
  assert.equal(out.matches[0].ambiguous, true);
});

test('V0.2.9 : avertissement comportemental A1/A2/A3', () => {
  const employee = { infoTokens: [] };
  setALevel(employee, 1);
  assert.equal(getALevel(employee), 1);
  assert.equal(incrementALevel(employee), 2);
  assert.equal(incrementALevel(employee), 3);
  assert.equal(incrementALevel(employee), 3);
  assert.equal(getALevel(employee), 3);
});
