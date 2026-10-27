import {
  FIXED_SALARY, REA_RATE, QUOTA_STANDARD, QUOTA_STAFF, EXEMPT_GRADES,
  NEAR_MISS_THRESHOLD, TOP3_BONUS, GRADE_ORDER,
} from '../config/payroll.js';
import { hasWeekAbsence } from './absenceService.js';
import {
  getQLevel, getALevel, hasS1, hasTag, setQLevel, setS1, removeSAndQ,
  isCleanForPromotion, warningLevel, warningReason,
} from './warningService.js';
import { automaticTarget } from './promotionService.js';

export function isBnvl(employee) {
  return hasTag(employee, 'BNVL') || /BNVL/i.test(employee.roleLabel || '');
}

export function isStaff(employee) {
  return hasTag(employee, 'STAFF');
}

export function isExempt(employee) {
  return EXEMPT_GRADES.includes(employee.grade);
}

export function quotaFor(employee) {
  if (isExempt(employee) || isBnvl(employee)) return 0;
  return isStaff(employee) ? QUOTA_STAFF : QUOTA_STANDARD;
}

export function quotaReached(employee, session) {
  if (isExempt(employee)) return true;
  if (isBnvl(employee)) return true;
  if (session.quotaOverrides?.[employee.idUnique] === true) return true;
  return Number(employee.reanimations || 0) >= quotaFor(employee);
}

export function buildNearQuotaQuestions(session) {
  const questions = [];
  for (const employee of session.employees) {
    if (employee.isWDV || isBnvl(employee) || isExempt(employee) || isStaff(employee)) continue;
    const r = Number(employee.reanimations || 0);
    if (r >= NEAR_MISS_THRESHOLD && r < QUOTA_STANDARD) {
      questions.push({
        id: `near:${employee.idUnique}`,
        type: 'near_quota',
        employeeId: employee.idUnique,
        title: 'Quota presque atteint',
        prompt: `${employee.name} a fait **${r}/${QUOTA_STANDARD}** réanimations.\nValider sa semaine comme quota atteint ?`,
      });
    }
  }
  return questions;
}

export function applyAutomaticQuotaTransitions(session) {
  const qConfirmationQuestions = [];
  const dismissalQuestions = [];
  const promotionQuestions = [];

  for (const employee of session.employees) {
    if (employee.isWDV || isBnvl(employee)) continue;

    employee.originalGrade ??= employee.grade;
    employee.originalInfoTokens ??= [...(employee.infoTokens || [])];

    const absence = hasWeekAbsence(employee, session.weekStart, session.weekEnd);
    employee.weekAbsence = absence;

    const reached = quotaReached(employee, session);
    const originalQ = getQLevel({ infoTokens: employee.originalInfoTokens });
    const originalA = getALevel({ infoTokens: employee.originalInfoTokens });
    const originalS1 = employee.originalInfoTokens.includes('S1');
    const isNew = hasTag(employee, 'NEW');

    if (!isExempt(employee)) {
      if (reached) {
        if (originalQ === 1) setS1(employee);
        else if (originalQ > 1) setQLevel(employee, originalQ - 1);
        else if (!originalS1 || isNew) setS1(employee);
      } else if (!absence) {
        if (isNew && employee.grade !== 'STG') {
          // NEW > STG : pas de Q cette semaine.
        } else if (['STG', 'A', 'INF', 'M'].includes(employee.grade)) {
          setQLevel(employee, Math.min(3, originalQ + 1 || 1));
        } else if (['MF', 'MP', 'RF', 'RP'].includes(employee.grade)) {
          qConfirmationQuestions.push({
            id: `qconfirm:${employee.idUnique}`,
            type: 'q_confirm',
            employeeId: employee.idUnique,
            title: 'Avertissement quota',
            prompt: `${employee.name} [${employee.grade}] a fait **${employee.reanimations}/${quotaFor(employee)}** réanimations.\nAjouter le Q prévu par la règle ?`,
            nextQ: Math.min(3, originalQ + 1 || 1),
          });
        }
      }
    }

    // Licenciements principaux du prototype.
    if (!reached && !absence) {
      if (employee.grade === 'STG' && originalQ + originalA > 2) {
        dismissalQuestions.push({
          id: `dismiss:${employee.idUnique}`,
          type: 'dismiss',
          employeeId: employee.idUnique,
          title: 'Licenciement proposé',
          prompt: `${employee.name} [STG] dépasse le seuil Q + A > 2.\nValider le licenciement ?`,
          reason: `STG : cumul Q + A = ${originalQ + originalA}`,
        });
      } else if (['A', 'INF'].includes(employee.grade) && originalQ >= 3) {
        dismissalQuestions.push({
          id: `dismiss:${employee.idUnique}`,
          type: 'dismiss',
          employeeId: employee.idUnique,
          title: 'Licenciement proposé',
          prompt: `${employee.name} [${employee.grade}] avait déjà Q${originalQ} et n'atteint pas son quota.\nValider le licenciement ?`,
          reason: `Q${originalQ} déjà présent + quota non atteint`,
        });
      }
    }

    // STG -> A automatique si quota atteint et fiche clean.
    if (employee.grade === 'STG' && reached && isCleanForPromotion({ ...employee, infoTokens: employee.originalInfoTokens })) {
      employee.pendingAutoPromotion = 'A';
    }

    // Promotions normales : S1 présent au début, quota atteint, fiche clean.
    if (employee.grade !== 'STG' && reached && originalS1 && isCleanForPromotion({ ...employee, infoTokens: employee.originalInfoTokens })) {
      const target = automaticTarget(employee.grade);
      if (target) {
        promotionQuestions.push({
          id: `promote:${employee.idUnique}`,
          type: 'promote',
          employeeId: employee.idUnique,
          title: 'Promotion proposée',
          prompt: `${employee.name}\n**${employee.grade} → ${target}**\n${employee.reanimations} réanimations · quota atteint · S1 présent.\nValider la promotion ?`,
          targetGrade: target,
        });
      } else if (employee.grade === 'M') {
        promotionQuestions.push({
          id: `specialize:${employee.idUnique}`,
          type: 'specialize',
          employeeId: employee.idUnique,
          title: 'Spécialisation proposée',
          prompt: `${employee.name} [M] est éligible à une spécialisation.\nChoisir **MF** ou **MP**, ou refuser.`,
        });
      }
    }
  }

  // Appliquer STG automatiques une seule fois.
  for (const employee of session.employees) {
    if (!employee.pendingAutoPromotion) continue;
    const from = employee.grade;
    const to = employee.pendingAutoPromotion;
    employee.grade = to;
    employee.lastUpRaw = session.weekEndLabel || '';
    removeSAndQ(employee);
    session.promotions.push({
      employeeId: employee.idUnique,
      name: employee.name,
      from,
      to,
      manual: false,
      automatic: true,
      reanimations: employee.reanimations || 0,
    });
    delete employee.pendingAutoPromotion;
  }

  session.questions.push(...qConfirmationQuestions, ...dismissalQuestions, ...promotionQuestions);
}

export function buildTop3TieQuestions(session) {
  const eligible = session.employees
    .filter((e) => !e.isWDV && !isBnvl(e) && !e.dismissed)
    .sort((a, b) => (b.reanimations || 0) - (a.reanimations || 0) || a.name.localeCompare(b.name, 'fr'));

  const questions = [];
  let index = 0;
  while (index < eligible.length && index < 6) {
    const value = Number(eligible[index].reanimations || 0);
    let end = index;
    while (end + 1 < eligible.length && Number(eligible[end + 1].reanimations || 0) === value) end += 1;
    const group = eligible.slice(index, end + 1);
    const startRank = index + 1;
    const endRank = end + 1;
    if (group.length > 1 && startRank <= 3) {
      const lastPaidRank = Math.min(3, endRank);
      const choicesNeeded = Math.max(0, lastPaidRank - startRank + 1 - (endRank <= 3 ? 1 : 0));
      // Si tout le groupe entre dans le Top 3, le dernier rang est déduit automatiquement.
      // Si le groupe déborde du Top 3, il faut choisir chaque place payée.
      const actualChoices = endRank <= 3 ? Math.max(0, group.length - 1) : Math.max(0, 3 - startRank + 1);
      for (let offset = 0; offset < actualChoices; offset++) {
        const rank = startRank + offset;
        questions.push({
          id: `top3tie:${value}:${rank}`,
          type: 'top3_tie',
          title: 'Égalité Top 3 à départager',
          prompt: `Plusieurs EMS ont **${value} réanimations**.\nChoisis qui obtient la **place n°${rank}** parmi les ex æquo.`,
          tieValue: value,
          rank,
          candidates: group.map((e) => ({ idUnique: e.idUnique, name: e.name, reanimations: e.reanimations || 0 })),
        });
      }
    }
    index = end + 1;
  }
  return questions;
}

export function computeTop3(session) {
  const eligible = session.employees
    .filter((e) => !e.isWDV && !isBnvl(e) && !e.dismissed)
    .sort((a, b) => (b.reanimations || 0) - (a.reanimations || 0) || a.name.localeCompare(b.name, 'fr'));

  const selections = session.top3Selections || {};
  const ordered = [];
  let index = 0;
  while (index < eligible.length) {
    const value = Number(eligible[index].reanimations || 0);
    let end = index;
    while (end + 1 < eligible.length && Number(eligible[end + 1].reanimations || 0) === value) end += 1;
    const group = eligible.slice(index, end + 1);
    const startRank = index + 1;
    const selectedIds = [];
    for (let rank = startRank; rank <= Math.min(3, end + 1); rank++) {
      const id = selections[rank];
      if (id && group.some((e) => e.idUnique === id) && !selectedIds.includes(id)) selectedIds.push(id);
    }
    const selected = selectedIds.map((id) => group.find((e) => e.idUnique === id)).filter(Boolean);
    const rest = group.filter((e) => !selectedIds.includes(e.idUnique)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    ordered.push(...selected, ...rest);
    index = end + 1;
  }

  const top = [];
  for (let i = 0; i < Math.min(3, ordered.length); i++) {
    const employee = ordered[i];
    top.push({
      rank: i + 1,
      employeeId: employee.idUnique,
      name: employee.name,
      reanimations: employee.reanimations || 0,
      bonus: TOP3_BONUS[i],
    });
  }
  session.top3 = top;
  return top;
}

export function calculateEmployeePay(session, employee) {
  if (employee.isWDV || isBnvl(employee)) {
    return {
      fixedSalary: FIXED_SALARY[employee.originalGrade || employee.grade] || 0,
      hours: 0,
      baseFromTable: employee.tablePay || 0,
      reaAmount: 0,
      ppa: 0,
      optionalBonus: 0,
      top3Bonus: 0,
      deductions: employee.tablePay || 0,
      total: 0,
    };
  }

  const payGrade = employee.originalGrade || employee.grade;
  const fixedSalary = FIXED_SALARY[payGrade] || 0;
  const absence = Boolean(employee.weekAbsence);
  const reached = quotaReached(employee, session);
  const baseFromTable = Number(employee.tablePay || 0);

  let base = baseFromTable;
  let deductions = 0;
  if (!isExempt(employee) && !reached && !absence) {
    deductions += fixedSalary;
    base = Math.max(0, baseFromTable - fixedSalary);
  }

  const reaAmount = Number(employee.reanimations || 0) * REA_RATE;
  const ppa = Number(session.ppa[employee.idUnique] || 0);
  const optionalBonus = Number(session.optionalBonuses[employee.idUnique] || 0);
  const top3Bonus = Number(session.top3.find((x) => x.employeeId === employee.idUnique)?.bonus || 0);

  const hours = Math.max(0, baseFromTable - fixedSalary);
  const total = Math.max(0, base + reaAmount + ppa + optionalBonus + top3Bonus);

  return {
    fixedSalary,
    hours,
    baseFromTable,
    reaAmount,
    ppa,
    optionalBonus,
    top3Bonus,
    deductions,
    total,
  };
}

export function refreshWarnings(session) {
  const upwardPromoted = new Set(
    (session.promotions || [])
      .filter((p) => GRADE_ORDER.indexOf(p.to) > GRADE_ORDER.indexOf(p.from))
      .map((p) => p.employeeId),
  );
  session.warnings = session.employees
    .filter((e) => !e.isWDV && !e.dismissed && !upwardPromoted.has(e.idUnique))
    .map((employee) => ({
      employeeId: employee.idUnique,
      name: employee.name,
      level: warningLevel(employee),
      reason: warningReason(employee),
    }))
    .filter((w) => w.level > 0);
}
