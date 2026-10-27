import { INITIAL_RECORD } from '../config/payroll.js';

let activeSession = null;

export function getActiveSession() {
  return activeSession;
}

export function createSession({ weekStart, weekEnd, managerId, managerName, threadId }) {
  if (activeSession) throw new Error('Une session de paie est déjà active.');
  activeSession = {
    id: `${Date.now()}`,
    weekStart,
    weekEnd,
    managerId,
    managerName,
    threadId,
    createdAt: Date.now(),

    stage: 'import_ems',
    rawEMS: '',
    rawReanimations: '',

    employees: [],
    reanimations: [],
    anomalies: [],
    memberMatches: new Map(),

    questions: [],
    currentQuestionIndex: 0,
    questionSnapshots: [],
    quotaOverrides: {},

    ppa: {},
    optionalBonuses: {},
    promotions: [],
    demotions: [],
    warnings: [],
    dismissals: [],
    top3: [],
    record: INITIAL_RECORD,

    finalized: false,
    locked: false,
  };
  return activeSession;
}

export function clearSession() {
  activeSession = null;
}

export function appendRaw(kind, text) {
  if (!activeSession) throw new Error('Aucune session active.');
  const key = kind === 'ems' ? 'rawEMS' : 'rawReanimations';
  activeSession[key] += `${activeSession[key] ? '\n' : ''}${String(text || '')}`;
}

export function snapshotForBack(session) {
  return JSON.parse(JSON.stringify({
    employees: session.employees,
    ppa: session.ppa,
    optionalBonuses: session.optionalBonuses,
    promotions: session.promotions,
    demotions: session.demotions,
    warnings: session.warnings,
    dismissals: session.dismissals,
    top3: session.top3,
    top3Selections: session.top3Selections || {},
    quotaOverrides: session.quotaOverrides,
    currentQuestionIndex: session.currentQuestionIndex,
    questions: session.questions,
    stage: session.stage,
  }));
}

export function restoreSnapshot(session, snapshot) {
  Object.assign(session, snapshot);
}
