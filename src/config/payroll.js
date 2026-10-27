export const GRADE_ORDER = Object.freeze([
  'STG', 'A', 'INF', 'M', 'MF', 'MP', 'RF', 'RP', 'MC', 'ADD', 'CD', 'D', 'DG',
]);

export const GRADE_LABELS = Object.freeze({
  STG: 'Stagiaire',
  A: 'Ambulancier',
  INF: 'Infirmier',
  M: 'Médecin',
  MF: 'Médecin Formateur',
  MP: 'Médecin Psychologue',
  RF: 'Responsable Formateur',
  RP: 'Responsable Psychologue',
  MC: 'Médecin Chef',
  ADD: 'Assistant de Direction',
  CD: 'Co-Directeur',
  D: 'Directeur',
  DG: 'Directeur Général',
});

export const FIXED_SALARY = Object.freeze({
  STG: 5_000_000,
  A: 6_000_000,
  INF: 7_000_000,
  M: 8_000_000,
  MF: 9_000_000,
  MP: 9_000_000,
  RF: 10_000_000,
  RP: 10_000_000,
  MC: 11_500_000,
  ADD: 11_500_000,
  CD: 13_500_000,
  D: 15_000_000,
  DG: 15_000_000,
});

export const REA_RATE = 14_000;
export const QUOTA_STANDARD = 70;
export const QUOTA_STAFF = 30;
export const NEAR_MISS_THRESHOLD = 65;
export const EXEMPT_GRADES = Object.freeze(['MC', 'ADD', 'CD', 'D', 'DG']);
export const TOP3_BONUS = Object.freeze([3_000_000, 2_000_000, 1_000_000]);
export const PPA_WEEKLY_CAP = 10_000_000;
export const INITIAL_RECORD = 1732;

export const NEXT_GRADES = Object.freeze({
  STG: ['A'],
  A: ['INF'],
  INF: ['M'],
  M: ['MF', 'MP'],
  MF: ['RF'],
  MP: ['RP'],
  RF: ['MC'],
  RP: ['MC'],
  MC: ['ADD'],
  ADD: ['CD'],
  CD: ['D'],
  D: ['DG'],
  DG: [],
});

export const AUTO_PROMOTION_CHAIN = Object.freeze({
  STG: 'A',
  A: 'INF',
  INF: 'M',
  MF: 'RF',
  MP: 'RP',
  RF: 'MC',
  RP: 'MC',
});
