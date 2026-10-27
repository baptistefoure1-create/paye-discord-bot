import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaFor, calculateEmployeePay, computeTop3 } from '../src/services/payrollRules.js';

function session(employee) {
  return {
    employees: [employee],
    quotaOverrides: {},
    ppa: {},
    optionalBonuses: {},
    top3: [],
    weekStart: new Date(Date.UTC(2026, 9, 17)),
    weekEnd: new Date(Date.UTC(2026, 9, 23)),
  };
}

test('quota STAFF = 30', () => {
  assert.equal(quotaFor({ grade: 'M', infoTokens: ['STAFF'], roleLabel: '' }), 30);
});

test('quota grade exempté = 0', () => {
  assert.equal(quotaFor({ grade: 'ADD', infoTokens: [], roleLabel: '' }), 0);
});

test('BNVL = 0 dollar', () => {
  const e = { idUnique: '1', grade: 'M', originalGrade: 'M', infoTokens: ['BNVL'], roleLabel: '', tablePay: 8_000_000, reanimations: 500, isWDV: false };
  const s = session(e);
  assert.equal(calculateEmployeePay(s, e).total, 0);
});

test('quota non atteint retire le fixe hors absence', () => {
  const e = { idUnique: '2', grade: 'A', originalGrade: 'A', infoTokens: [], roleLabel: '', tablePay: 8_000_000, reanimations: 10, isWDV: false, weekAbsence: false };
  const s = session(e);
  const pay = calculateEmployeePay(s, e);
  assert.equal(pay.total, 2_000_000 + 10 * 14_000);
});

test('Top 3 attribue 3M/2M/1M', () => {
  const s = {
    employees: [
      { idUnique: '1', name: 'A', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 100, isWDV: false },
      { idUnique: '2', name: 'B', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 90, isWDV: false },
      { idUnique: '3', name: 'C', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 80, isWDV: false },
    ],
    top3: [],
  };
  const top = computeTop3(s);
  assert.deepEqual(top.map((x) => x.bonus), [3_000_000, 2_000_000, 1_000_000]);
});

import { buildTop3TieQuestions } from '../src/services/payrollRules.js';

test('égalité à la 3e place crée une question de départage', () => {
  const s = {
    employees: [
      { idUnique: '1', name: 'A', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 100, isWDV: false },
      { idUnique: '2', name: 'B', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 90, isWDV: false },
      { idUnique: '3', name: 'C', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 80, isWDV: false },
      { idUnique: '4', name: 'D', grade: 'M', infoTokens: [], roleLabel: '', reanimations: 80, isWDV: false },
    ],
  };
  const qs = buildTop3TieQuestions(s);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].rank, 3);
});

import { applyAutomaticQuotaTransitions } from '../src/services/payrollRules.js';

test('Q1 + quota atteint devient S1', () => {
  const e = { idUnique:'10', name:'Jean', grade:'A', infoTokens:['Q1'], roleLabel:'', reanimations:80, isWDV:false, tablePay:6000000, absencesRaw:'' };
  const s = { employees:[e], quotaOverrides:{}, promotions:[], questions:[], dismissals:[], weekStart:new Date(Date.UTC(2026,9,17)), weekEnd:new Date(Date.UTC(2026,9,23)), weekEndLabel:'23/10/2026' };
  applyAutomaticQuotaTransitions(s);
  assert.ok(e.infoTokens.includes('S1'));
  assert.equal(e.infoTokens.some(x => /^Q/.test(x)), false);
});
