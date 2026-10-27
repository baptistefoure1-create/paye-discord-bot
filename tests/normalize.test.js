import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, similarity } from '../src/utils/normalize.js';

test('normalizeName gère accents/apostrophes/casse', () => {
  assert.equal(normalizeName("Cloé  O’Connor"), "cloe o'connor");
});

test('similarity reconnaît une petite faute raisonnable', () => {
  assert.ok(similarity('Zakaria el mkhntr', 'Zakaria El Mkhntr') > 0.95);
  assert.ok(similarity('Leon Kennedy', 'Léon Kennedy') > 0.95);
});
