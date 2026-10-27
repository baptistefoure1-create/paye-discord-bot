import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWarningDiscordMessage } from '../src/services/txtGenerator.js';
import { ROLES } from '../src/config/roles.js';

test('avertissements Discord pingent le rôle et le joueur reconnu', () => {
  const session = {
    promotions: [],
    memberMatches: new Map([['1', { memberId: '999999999999999999' }]]),
    employees: [{
      idUnique: '1', name: 'Jean Test', grade: 'A', infoTokens: ['Q1'], isWDV: false, dismissed: false,
    }],
  };
  const text = buildWarningDiscordMessage(session);
  assert.match(text, new RegExp(`<@&${ROLES.WARNING_1}>`));
  assert.match(text, /<@999999999999999999>/);
});

test('avertissements Discord utilisent le nom RP si joueur non trouvé', () => {
  const session = {
    promotions: [],
    memberMatches: new Map([['1', { memberId: null, status: 'missing' }]]),
    employees: [{
      idUnique: '1', name: 'Jean Introuvable', grade: 'A', infoTokens: ['A1'], isWDV: false, dismissed: false,
    }],
  };
  const text = buildWarningDiscordMessage(session);
  assert.match(text, /Jean Introuvable/);
  assert.doesNotMatch(text, /<@undefined>|<@null>/);
});
