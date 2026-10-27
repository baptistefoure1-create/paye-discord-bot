export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const digits = String(value ?? '').replace(/[^\d-]/g, '');
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(amount))} $`;
}

export function compactMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000) {
    const v = amount / 1_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(2).replace('.', ',')} M$`;
  }
  if (Math.abs(amount) >= 1_000) {
    const v = amount / 1_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')}k$`;
  }
  return `${amount}$`;
}
