import { GRADE_ORDER } from '../config/payroll.js';
import { parseMoney } from '../utils/money.js';

const GRADE_SET = new Set([...GRADE_ORDER, 'WDV']);
const INFO_TOKEN_RE = /\b(?:S\d*|Q[1-3]|A[1-3]|AB\d*|AL\d*|STAFF|NEW|BNVL)\b/gi;

function cleanDisplayName(value) {
  return String(value || '')
    .replace(/^[.\s]+/, '')
    .replace(/\s+[🐧✅❌⚠️]+.*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferGrade(roleLabel, rawGrade) {
  const raw = String(rawGrade || '').trim().toUpperCase();
  if (GRADE_SET.has(raw)) return raw;
  const clean = String(roleLabel || '').replace(/\/S\b/i, '').replace(/^EX-/, '');
  for (const grade of [...GRADE_ORDER, 'WDV'].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?:^|[^A-Z])${grade}(?:$|[^A-Z])`, 'i');
    if (re.test(clean)) return grade;
  }
  return null;
}

function buildEmployee({ folder, employeeCell, idUnique, grade, info = '', absences = '', rea = '', up = '', pay = '', arrival = '', sourceLine }) {
  const bracket = String(employeeCell || '').match(/^\[([^\]]+)\]\s*(.+)$/);
  const displayName = cleanDisplayName(bracket ? bracket[2] : employeeCell);
  const roleLabel = bracket ? bracket[1] : '';
  const normalizedGrade = inferGrade(roleLabel, grade);

  return {
    folder: String(folder || '').trim(),
    name: displayName,
    idUnique: String(idUnique || '').trim(),
    grade: normalizedGrade || String(grade || 'UNKNOWN').trim().toUpperCase(),
    roleLabel,
    infoRaw: String(info || '').trim(),
    infoTokens: Array.from(new Set((String(info || '').match(INFO_TOKEN_RE) || []).map((x) => x.toUpperCase()))),
    absencesRaw: String(absences || '').trim(),
    reaTable: Number.parseInt(String(rea || '0').replace(/\D/g, ''), 10) || 0,
    lastUpRaw: String(up || '').trim(),
    tablePay: parseMoney(pay),
    arrivalRaw: String(arrival || '').trim(),
    isWDV: normalizedGrade === 'WDV' || String(grade || '').trim().toUpperCase() === 'WDV' || /EX-/i.test(roleLabel),
    sourceLine,
  };
}

function splitColumnarLine(line) {
  const tabCols = line.split('\t').map((x) => x.trim());
  if (tabCols.length >= 8) return tabCols;

  // Certains copier/coller Discord remplacent les tabulations par plusieurs espaces.
  const spacedCols = line.split(/\s{2,}/).map((x) => x.trim()).filter((x) => x !== '');
  if (spacedCols.length >= 8) return spacedCols;
  return null;
}

function parseColumnarLine(line) {
  const cols = splitColumnarLine(line);
  if (!cols || !cols[0]?.includes('📂')) return null;

  // Le tableau Roster est : Dossier | Employé | ID | Grade | Info | Absences | Rea | Up | Paye | Date arrivée | Actions
  const [folder, employeeCell, idUnique, grade, info = '', absences = '', rea = '', up = '', pay = '', arrival = ''] = cols;
  if (!employeeCell || !idUnique) return null;
  return buildEmployee({ folder, employeeCell, idUnique, grade, info, absences, rea, up, pay, arrival, sourceLine: line });
}

function parseLooseLine(line) {
  if (!line.includes('📂')) return null;

  const folderM = line.match(/(📂[^\s]+)/u);
  if (!folderM) return null;

  const withoutFolder = line.replace(folderM[0], '').trim();
  const idM = withoutFolder.match(/\b(\d{1,7})\b/);
  if (!idM) return null;

  const beforeId = withoutFolder.slice(0, idM.index).trim();
  const bracket = beforeId.match(/^\[([^\]]+)\]\s*(.+)$/);
  const roleLabel = bracket ? bracket[1] : '';
  const employeeCell = bracket ? `[${roleLabel}] ${cleanDisplayName(bracket[2])}` : cleanDisplayName(beforeId);

  const afterId = withoutFolder.slice((idM.index || 0) + idM[0].length).trim();
  const gradeM = afterId.match(/^([A-Za-z]{1,4})\b/);
  const rawGrade = gradeM?.[1]?.toUpperCase() || '';
  const grade = inferGrade(roleLabel, rawGrade) || rawGrade || 'UNKNOWN';
  let remainder = gradeM ? afterId.slice(gradeM[0].length).trim() : afterId;

  // Date d'arrivée : ancrée en fin de ligne juste avant "Détails Paie" dans le Roster.
  let arrival = '';
  const arrivalM = remainder.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}:\d{2})(?=\s*(?:Détails\s+Paie)?\s*$)/i);
  if (arrivalM) {
    arrival = arrivalM[1];
    remainder = remainder.replace(arrivalM[0], ' ').replace(/Détails\s+Paie\s*$/i, '').trim();
  } else {
    remainder = remainder.replace(/Détails\s+Paie\s*$/i, '').trim();
  }

  // La dernière valeur monétaire avant la date d'arrivée est la Paye tableau.
  const moneyMatches = [...remainder.matchAll(/([\d\s\u202f]+)\s*\$/g)];
  let pay = '';
  if (moneyMatches.length) {
    const last = moneyMatches[moneyMatches.length - 1];
    pay = last[1];
    remainder = `${remainder.slice(0, last.index)} ${remainder.slice((last.index || 0) + last[0].length)}`.trim();
  }

  const infoTokens = Array.from(new Set((remainder.match(INFO_TOKEN_RE) || []).map((x) => x.toUpperCase())));
  let info = infoTokens.join(' ');

  // On récupère les dates restantes. Avec le tableau sans tabulations, la dernière date seule est généralement Date Up ;
  // une paire de dates correspond généralement aux absences.
  const dateTokens = remainder.match(/\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?/g) || [];
  let absences = '';
  let up = '';
  if (dateTokens.length >= 3) {
    absences = `${dateTokens[0]} - ${dateTokens[1]}`;
    up = dateTokens[dateTokens.length - 1];
  } else if (dateTokens.length === 2) {
    const pair = `${dateTokens[0]} - ${dateTokens[1]}`;
    const pairRe = new RegExp(`${dateTokens[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:-|→|au|a)\\s*${dateTokens[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (pairRe.test(remainder)) absences = pair;
    else up = dateTokens[dateTokens.length - 1];
  } else if (dateTokens.length === 1) {
    up = dateTokens[0];
  }

  // La colonne Rea du Roster vaut généralement 0 ; on la récupère seulement si un nombre isolé est présent.
  const stripped = remainder
    .replace(INFO_TOKEN_RE, ' ')
    .replace(/\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?/g, ' ')
    .replace(/ind[eé]termin[eé]e?/gi, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const numberTokens = stripped.match(/\b\d+\b/g) || [];
  const rea = numberTokens.length ? numberTokens[numberTokens.length - 1] : '0';

  return buildEmployee({
    folder: folderM[0], employeeCell, idUnique: idM[1], grade,
    info, absences, rea, up, pay, arrival, sourceLine: line,
  });
}

export function parseEMS(raw) {
  const employees = [];
  const anomalies = [];
  const lines = String(raw || '').split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!line.includes('📂')) continue;
    const parsed = parseColumnarLine(line) || parseLooseLine(line);
    if (!parsed || !parsed.name || !parsed.idUnique) {
      anomalies.push(`Ligne EMS ${index + 1} non reconnue : ${line.slice(0, 180)}`);
      continue;
    }
    employees.push(parsed);
  }

  const seen = new Map();
  for (const employee of employees) {
    const key = employee.idUnique;
    if (seen.has(key)) anomalies.push(`BLOQUANT : ID unique dupliqué : ${key} (${seen.get(key)} / ${employee.name})`);
    else seen.set(key, employee.name);
  }

  if (!employees.length) anomalies.push('BLOQUANT : aucun employé EMS détecté dans le tableau collé.');
  return { employees, anomalies };
}
