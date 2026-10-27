import { parseAbsenceRange, rangesOverlap } from '../utils/dates.js';

export function hasWeekAbsence(employee, weekStart, weekEnd) {
  const range = parseAbsenceRange(employee.absencesRaw, weekStart);
  if (!range) return false;
  return rangesOverlap(range.start, range.end, weekStart, weekEnd);
}
