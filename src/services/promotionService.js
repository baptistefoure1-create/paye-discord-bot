import { GRADE_ORDER, NEXT_GRADES, AUTO_PROMOTION_CHAIN } from '../config/payroll.js';

export function higherGrades(grade) {
  const idx = GRADE_ORDER.indexOf(grade);
  return idx < 0 ? [] : GRADE_ORDER.slice(idx + 1);
}

export function lowerGrades(grade) {
  const idx = GRADE_ORDER.indexOf(grade);
  return idx <= 0 ? [] : GRADE_ORDER.slice(0, idx);
}

export function automaticTarget(grade) {
  return AUTO_PROMOTION_CHAIN[grade] || null;
}

export function specializationChoices(grade) {
  return grade === 'M' ? ['MF', 'MP'] : (NEXT_GRADES[grade] || []);
}
