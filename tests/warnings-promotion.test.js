import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWarnings } from '../src/services/payrollRules.js';

test('une vraie promotion retire la personne des avertissements finaux', () => {
  const session = {
    employees: [{ idUnique: '1', name: 'Jean', grade: 'INF', infoTokens: ['A1'], isWDV: false, dismissed: false }],
    promotions: [{ employeeId: '1', from: 'A', to: 'INF' }],
  };
  refreshWarnings(session);
  assert.equal(session.warnings.length, 0);
});

test('une rétrogradation ne supprime pas un avertissement existant', () => {
  const session = {
    employees: [{ idUnique: '1', name: 'Jean', grade: 'A', infoTokens: ['A1'], isWDV: false, dismissed: false }],
    promotions: [],
    demotions: [{ employeeId: '1', from: 'INF', to: 'A' }],
  };
  refreshWarnings(session);
  assert.equal(session.warnings.length, 1);
});
