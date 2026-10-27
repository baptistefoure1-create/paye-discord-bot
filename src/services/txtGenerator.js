import { GRADE_ORDER, GRADE_LABELS, EXEMPT_GRADES } from '../config/payroll.js';
import { formatDateFR, fileDateRange } from '../utils/dates.js';
import { calculateEmployeePay, isBnvl } from './payrollRules.js';
import { warningLevel, warningReason } from './warningService.js';
import { ROLES } from '../config/roles.js';

const SECTIONS = [
  { label: 'STAGIAIRES (STG)', grades: ['STG'] },
  { label: 'AMBULANCIERS (A)', grades: ['A'] },
  { label: 'INFIRMIERS (INF)', grades: ['INF'] },
  { label: 'MÉDECINS (M)', grades: ['M'] },
  { label: 'MÉDECIN FORMATEUR / PSYCHOLOGUE (MF/MP)', grades: ['MF', 'MP'] },
  { label: 'RESPONSABLE FORMATEUR / PSYCHOLOGUE (RF/RP)', grades: ['RF', 'RP'] },
  { label: 'MÉDECIN CHEF (MC)', grades: ['MC'] },
  { label: 'ASSISTANT DE DIRECTION (ADD)', grades: ['ADD'] },
  { label: 'CO-DIRECTEUR (CD)', grades: ['CD'] },
  { label: 'DIRECTEUR (D)', grades: ['D'] },
  { label: 'DIRECTEUR GÉNÉRAL (DG)', grades: ['DG'] },
];

function sortByGradeThenName(a, b) {
  const ai = GRADE_ORDER.indexOf(a.grade);
  const bi = GRADE_ORDER.indexOf(b.grade);
  return (bi - ai) || a.name.localeCompare(b.name, 'fr');
}

function memberMention(session, employeeId, fallbackName) {
  const match = session.memberMatches?.get?.(employeeId);
  return match?.memberId ? `<@${match.memberId}>` : fallbackName;
}

function shortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = String(date.getUTCFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

function nextDayShort(date) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  return shortDate(d);
}

function header(title, session) {
  return [
    '════════════════════════════════════════',
    `${title} — Semaine ${shortDate(session.weekStart)} - ${shortDate(session.weekEnd)}`,
    '════════════════════════════════════════',
    '',
  ].join('\n');
}

function internalFooter() {
  return [
    '',
    '════════════════════════════════════════',
    '⚠️  Fichier à usage INTERNE uniquement.',
    '    Ne pas copier-coller sur Discord.',
    '════════════════════════════════════════',
  ].join('\n');
}

function upwardPromotion(session, employee) {
  const p = session.promotions.find((x) => x.employeeId === employee.idUnique);
  if (!p) return null;
  return GRADE_ORDER.indexOf(p.to) > GRADE_ORDER.indexOf(p.from) ? p : null;
}

function demotion(session, employee) {
  return session.demotions.find((x) => x.employeeId === employee.idUnique) || null;
}

function infoText(employee) {
  return (employee.infoTokens || []).join(' ') || 'vide';
}

function tableauComplet(session) {
  const active = session.employees.filter((e) => !e.isWDV && !e.dismissed);
  const byGrade = new Map();
  for (const e of active) {
    if (!byGrade.has(e.grade)) byGrade.set(e.grade, []);
    byGrade.get(e.grade).push(e);
  }

  const lines = [header('TABLEAU COMPLET', session)];
  for (const section of SECTIONS) {
    const members = section.grades.flatMap((g) => byGrade.get(g) || []);
    if (!members.length) continue;
    lines.push(`── ${section.label} ──`, '');

    for (const e of members.sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      const promo = upwardPromotion(session, e);
      const demo = demotion(session, e);
      const movementTag = promo ? ` ⬆️ UP (ex-${promo.from})` : demo ? ` ⬇️ RÉTROGRADATION (ex-${demo.from})` : '';
      const wipeInfo = Boolean(promo);
      const isNew = (e.infoTokens || []).includes('NEW');
      const gradeLabel = GRADE_LABELS[e.grade] || e.grade;

      lines.push(`${e.name} (ID: ${e.idUnique})${movementTag}`);
      lines.push(`Grade    : ${gradeLabel}${isNew ? ' ⬆️ NEW' : ''}`);
      lines.push(`Info     : ${wipeInfo ? 'vide' : infoText(e)}`);
      lines.push(`Absences : ${wipeInfo || isBnvl(e) ? 'vide' : (e.absencesRaw || 'vide')}`);
      lines.push(`Date Up  : ${promo || demo ? nextDayShort(session.weekEnd) : (e.lastUpRaw || 'À COMPLÉTER')}`);
      lines.push('────────────────────────────────────────');
    }
    lines.push('');
  }

  lines.push(internalFooter());
  return lines.join('\n');
}

function isRealUp(session, employee) {
  const p = session.promotions.find((x) => x.employeeId === employee.idUnique);
  return Boolean(p && GRADE_ORDER.indexOf(p.to) > GRADE_ORDER.indexOf(p.from));
}

function warningsTxt(session) {
  const groups = new Map([[1, []], [2, []], [3, []]]);
  for (const e of session.employees) {
    if (e.isWDV || e.dismissed || isRealUp(session, e)) continue;
    const level = warningLevel(e);
    if (level > 0) groups.get(Math.min(level, 3)).push(e);
  }

  const lines = ['EMS Sanctionnés :', ''];
  let any = false;
  for (const level of [1, 2, 3]) {
    const arr = groups.get(level).sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || a.name.localeCompare(b.name, 'fr'));
    if (!arr.length) continue;
    any = true;
    lines.push(`@Averto ${level}`);
    for (const e of arr) {
      const suffix = level === 3 ? ' (licenciement semaine prochaine si quota non atteint)' : '';
      lines.push(`@${e.name} (${warningReason(e)}${suffix})`);
    }
    lines.push('');
  }
  if (!any) lines.push('Aucun EMS sanctionné cette semaine.');
  return lines.join('\n');
}

function payesTxt(session) {
  const lines = [];
  const employees = [...session.employees]
    .filter((e) => !e.isWDV && !isBnvl(e) && (Number(e.reanimations || 0) > 0 || EXEMPT_GRADES.includes(e.originalGrade || e.grade)))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  for (const e of employees) {
    const pay = calculateEmployeePay(session, e);
    const promo = session.promotions.find((p) => p.employeeId === e.idUnique);
    const demo = session.demotions.find((p) => p.employeeId === e.idUnique);

    lines.push('≿━━━━━━━━━༺❀༻━━━━━━━━━≾');
    lines.push(`[${e.grade}] ${e.name}${e.dismissed ? ' (LICENCIÉ)' : ''}`);
    // Même logique que le vrai Pillbox : montant sans séparateur de milliers pour faciliter le copier/coller IG.
    lines.push(`💰 Paye : **${Math.round(pay.total)} $**`);
    lines.push(`🚑 Réanimations : **${e.reanimations || 0}**`);
    if (demo) lines.push(`⬇️ RÉTROGRADATION : **${GRADE_LABELS[demo.to] || demo.to}**`);
    else if (promo) lines.push(`⬆️ UP : **${GRADE_LABELS[promo.to] || promo.to}**`);
  }
  lines.push('≿━━━━━━━━━༺❀༻━━━━━━━━━≾');
  return lines.join('\n');
}

function computeAnnonceTiming(now = new Date()) {
  const parisHour = Number.parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23',
  }).format(now), 10);
  if (parisHour < 8) {
    const parisDayName = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' }).format(now);
    return { greeting: 'Bonsoir', moment: parisDayName };
  }
  if (parisHour < 12) return { greeting: 'Bonjour', moment: 'ce matin' };
  if (parisHour < 17) return { greeting: 'Bonjour', moment: 'cet après-midi' };
  return { greeting: 'Bonsoir', moment: 'ce soir' };
}

function announcementTxt(session) {
  const { greeting, moment } = computeAnnonceTiming();
  const fmtMoney = (n) => Math.round(n).toLocaleString('de-DE');
  const lines = [
    `**${greeting} à tous,**`,
    `<@&${ROLES.EMPLOYEES}>`,
    "Une nouvelle semaine commence à l'hôpital Pillbox !",
    '🏆',
    '**Top 3 de la semaine :**',
  ];

  const medals = ['1️⃣', '2️⃣', '3️⃣'];
  for (const item of session.top3) {
    lines.push(`${medals[item.rank - 1]} ${memberMention(session, item.employeeId, item.name)} gagne une prime de **${fmtMoney(item.bonus)}$** avec **${item.reanimations}** réanimations`);
  }

  lines.push('');
  lines.push(`(Record à battre : ${new Intl.NumberFormat('fr-FR').format(session.record).replace(/\u202f/g, ' ')} réanimations)`);
  if (session.top3[0] && session.top3[0].reanimations > session.record) lines.push('🎉 NOUVEAU RECORD BATTU CETTE SEMAINE !');
  lines.push('');
  lines.push(`Les payes de la semaine (ainsi que les Up) seront disponibles ${moment}`);
  lines.push("et ce jusqu'à mercredi. Après cette date, les payes et UP ne seront");
  lines.push('plus récupérables.');
  lines.push('');
  lines.push(`Si je ne suis pas disponible, n'hésitez pas à ping un <@&${ROLES.HIGH_GRADE}> !`);
  lines.push('');
  lines.push('Bon service à tous !');
  return lines.join('\n');
}

function dismissalsTxt(session) {
  const lines = [header('LICENCIEMENTS', session)];
  if (!session.dismissals.length) {
    lines.push('Aucun licenciement cette semaine.');
    lines.push(internalFooter());
    return lines.join('\n');
  }
  const sorted = [...session.dismissals].sort((a, b) => {
    const ai = GRADE_ORDER.indexOf(a.grade);
    const bi = GRADE_ORDER.indexOf(b.grade);
    return (bi - ai) || a.name.localeCompare(b.name, 'fr');
  });
  for (const d of sorted) {
    lines.push(`${d.name} (ID: ${d.employeeId}) — Grade : ${GRADE_LABELS[d.grade] || d.grade}`);
    lines.push(`Raison : ${d.reason}`);
    lines.push('');
  }
  lines.push(internalFooter());
  return lines.join('\n');
}

function promotionsTxt(session) {
  const lines = [header('PROMOTIONS', session)];
  const actions = [
    ...session.promotions.map((p) => ({ ...p, kind: 'promotion' })),
    ...session.demotions.map((d) => ({ ...d, kind: 'demotion' })),
  ].sort((a, b) => {
    const ai = GRADE_ORDER.indexOf(a.from);
    const bi = GRADE_ORDER.indexOf(b.from);
    return (bi - ai) || a.name.localeCompare(b.name, 'fr');
  });

  if (!actions.length) {
    lines.push('Aucune promotion ou rétrogradation cette semaine.');
    lines.push(internalFooter());
    return lines.join('\n');
  }

  actions.forEach((p, i) => {
    const tag = p.kind === 'demotion' ? ' ⬇️ RÉTROGRADATION MANUELLE' : p.manual ? ' ⬆️ UP MANUELLE' : '';
    lines.push(`${p.name} (ID: ${p.employeeId})${tag}`);
    lines.push(`${GRADE_LABELS[p.from] || p.from} → ${GRADE_LABELS[p.to] || p.to}`);
    lines.push(`(${p.reanimations || 0} réanimations)`);
    lines.push('');
    if (i < actions.length - 1) lines.push('────────────────────────────────────────', '');
  });

  const stagiaires = actions.filter((p) => p.kind === 'promotion' && p.from === 'STG' && p.to === 'A');
  if (stagiaires.length) {
    lines.push('── MESSAGES TICKETS STAGIAIRES → AMBULANCIER ──────────────', '');
    for (const p of stagiaires) {
      lines.push(`Bonjour @${p.name},`);
      lines.push('');
      lines.push("Je viens t'annoncer que, comme tu as fait ton quota ainsi que ton engagement pour cette semaine, tu es up ambulancier.");
      lines.push('');
      lines.push("Félicitations, je t'invite à venir prendre ton nouveau rôle et ta paye.");
      lines.push('');
    }
  }

  lines.push(internalFooter());
  return lines.join('\n');
}

export function buildWarningDiscordMessage(session) {
  const groups = new Map([[1, []], [2, []], [3, []]]);
  for (const e of session.employees) {
    if (e.isWDV || e.dismissed || isRealUp(session, e)) continue;
    const level = warningLevel(e);
    if (level) groups.get(Math.min(level, 3)).push(e);
  }

  const roleByLevel = { 1: ROLES.WARNING_1, 2: ROLES.WARNING_2, 3: ROLES.WARNING_3 };
  const lines = ['**EMS Sanctionnés :**', ''];
  let any = false;

  for (const level of [1, 2, 3]) {
    const arr = groups.get(level).sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || a.name.localeCompare(b.name, 'fr'));
    if (!arr.length) continue;
    any = true;
    // V0.2.1 : ping du rôle Averto ET des joueurs reconnus sur Discord.
    // Si un joueur n'est pas assigné/trouvé, on garde uniquement son nom RP.
    lines.push(`<@&${roleByLevel[level]}>`);
    for (const e of arr) {
      const suffix = level === 3 ? ' (licenciement semaine prochaine si quota non atteint)' : '';
      const target = memberMention(session, e.idUnique, e.name);
      lines.push(`• ${target} — ${warningReason(e)}${suffix}`);
    }
    lines.push('');
  }

  return any ? lines.join('\n') : '**EMS Sanctionnés :**\n\nAucun EMS sanctionné cette semaine.';
}

export function buildAnnouncementDiscordMessage(session) {
  return announcementTxt(session);
}

export function generateSixTxt(session) {
  const suffix = fileDateRange(session.weekStart, session.weekEnd);
  const specs = [
    [`TABLEAU COMPLET ${suffix}.txt`, tableauComplet(session)],
    [`AVERTISSEMENTS DISCORD ${suffix}.txt`, warningsTxt(session)],
    [`PAYES ${suffix}.txt`, payesTxt(session)],
    [`ANNONCE DISCORD ${suffix}.txt`, announcementTxt(session)],
    [`LICENCIEMENTS ${suffix}.txt`, dismissalsTxt(session)],
    [`PROMOTIONS ${suffix}.txt`, promotionsTxt(session)],
  ];
  return specs.map(([name, content]) => ({
    name,
    content,
    attachment: { attachment: Buffer.from(content, 'utf8'), name },
  }));
}

export const buildTableauCompletText = tableauComplet;
export const buildPayesText = payesTxt;
export const buildWarningsText = warningsTxt;
export const buildPromotionsText = promotionsTxt;
