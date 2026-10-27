import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReanimations } from '../src/services/parserReanimations.js';

test('parse le tableau réanimations', () => {
  const raw = `Interventions — Ambulance Pillbox
1. Tio War — Réanimations: 291 · Factures encaissées: 0 · Montant factures: $ 0
2. Baptiste Fore — Réanimations: 221 · Factures encaissées: 0 · Montant factures: $ 0`;
  const out = parseReanimations(raw);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].name, 'Tio War');
  assert.equal(out.results[0].reanimations, 291);
});
