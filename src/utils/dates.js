function parseFrenchDatePart(part, fallbackYear = new Date().getFullYear()) {
  if (!part) return null;
  const m = String(part).trim().match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!m) return null;
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function parseDateFR(value, fallbackYear) {
  return parseFrenchDatePart(value, fallbackYear);
}

export function parseAbsenceRange(value, weekStart) {
  const raw = String(value || '').replace(/[^\d\/.\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const candidates = raw.match(/\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?/g) || [];
  if (candidates.length < 2) return null;
  const year = weekStart?.getUTCFullYear?.() || new Date().getFullYear();
  let start = parseFrenchDatePart(candidates[0], year);
  let end = parseFrenchDatePart(candidates[1], year);
  if (!start || !end) return null;
  if (end < start) {
    end = parseFrenchDatePart(candidates[1], year + 1) || end;
  }
  return { start, end };
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function formatDateFR(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

export function weekKey(start, end) {
  return `${formatDateFR(start)}-${formatDateFR(end)}`;
}

export function fileDateRange(start, end) {
  const d1 = String(start.getUTCDate()).padStart(2, '0');
  const d2 = String(end.getUTCDate()).padStart(2, '0');
  const m = String(end.getUTCMonth() + 1).padStart(2, '0');
  const y = String(end.getUTCFullYear()).slice(-2);
  return `${d1}-${d2}.${m}.${y}`;
}
