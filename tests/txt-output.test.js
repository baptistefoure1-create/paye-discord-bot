import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayesText, buildTableauCompletText, buildWarningsText } from '../src/services/txtGenerator.js';

function baseSession() {
  const weekStart = new Date(Date.UTC(2026, 9, 17));
  const weekEnd = new Date(Date.UTC(2026, 9, 23));
  return {
    weekStart, weekEnd,
    employees: [
      { idUnique:'1', name:'Papy Alucard', grade:'DG', originalGrade:'DG', infoTokens:[], absencesRaw:'', lastUpRaw:'', tablePay:15000000, reanimations:0, isWDV:false, dismissed:false, roleLabel:'' },
      { idUnique:'2', name:'Baptiste Fore', grade:'ADD', originalGrade:'ADD', infoTokens:['S1'], absencesRaw:'', lastUpRaw:'12/09/26', tablePay:11500000, reanimations:0, isWDV:false, dismissed:false, roleLabel:'' },
      { idUnique:'3', name:'Jean Troudeau', grade:'A', originalGrade:'A', infoTokens:[], absencesRaw:'', lastUpRaw:'17/10/26', tablePay:6000000, reanimations:100, isWDV:false, dismissed:false, roleLabel:'' },
      { idUnique:'4', name:'Sanchez Els', grade:'STG', originalGrade:'STG', infoTokens:[], absencesRaw:'', lastUpRaw:'', tablePay:5000000, reanimations:0, isWDV:false, dismissed:false, roleLabel:'' },
      { idUnique:'5', name:'Weed Crazy', grade:'WDV', originalGrade:'WDV', infoTokens:[], absencesRaw:'', lastUpRaw:'', tablePay:0, reanimations:0, isWDV:true, dismissed:false, roleLabel:'EX-ADD' },
    ],
    quotaOverrides:{}, ppa:{}, optionalBonuses:{}, top3:[], promotions:[], demotions:[], dismissals:[], memberMatches:new Map(), record:1732,
  };
}

test('PAYES conserve les grades exemptés même avec 0 réanimation', () => {
  const out = buildPayesText(baseSession());
  assert.match(out, /\[DG\] Papy Alucard/);
  assert.match(out, /\[ADD\] Baptiste Fore/);
  assert.match(out, /\[A\] Jean Troudeau/);
  assert.doesNotMatch(out, /Sanchez Els/);
  assert.doesNotMatch(out, /Weed Crazy/);
});

test('TABLEAU COMPLET contient tous les EMS actifs et les sections Pillbox', () => {
  const out = buildTableauCompletText(baseSession());
  assert.match(out, /STAGIAIRES \(STG\)/);
  assert.match(out, /ASSISTANT DE DIRECTION \(ADD\)/);
  assert.match(out, /DIRECTEUR GÉNÉRAL \(DG\)/);
  assert.match(out, /Sanchez Els/);
  assert.match(out, /Baptiste Fore/);
  assert.match(out, /Papy Alucard/);
  assert.doesNotMatch(out, /Weed Crazy/);
  assert.match(out, /Fichier à usage INTERNE uniquement/);
});

test('avertissements : une vraie UP ne reste pas dans le TXT', () => {
  const s = baseSession();
  s.employees[2].grade = 'INF';
  s.employees[2].infoTokens = ['A1'];
  s.promotions = [{ employeeId:'3', from:'A', to:'INF' }];
  const out = buildWarningsText(s);
  assert.doesNotMatch(out, /Jean Troudeau/);
});
