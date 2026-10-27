function levelFromToken(tokens, prefix) {
  const token = tokens.find((x) => new RegExp(`^${prefix}[1-3]$`, 'i').test(x));
  return token ? Number(token.slice(prefix.length)) : 0;
}

export function getQLevel(employee) {
  return levelFromToken(employee.infoTokens || [], 'Q');
}

export function getALevel(employee) {
  return levelFromToken(employee.infoTokens || [], 'A');
}

export function hasS1(employee) {
  return (employee.infoTokens || []).includes('S1');
}

export function hasTag(employee, tag) {
  return (employee.infoTokens || []).includes(tag);
}

export function setQLevel(employee, level) {
  employee.infoTokens = (employee.infoTokens || []).filter((x) => !/^Q[1-3]$/i.test(x) && !/^S\d*$/i.test(x));
  if (level > 0) employee.infoTokens.push(`Q${Math.min(level, 3)}`);
}

export function setS1(employee) {
  employee.infoTokens = (employee.infoTokens || []).filter((x) => !/^Q[1-3]$/i.test(x) && !/^S\d*$/i.test(x));
  employee.infoTokens.push('S1');
}

export function removeSAndQ(employee) {
  employee.infoTokens = (employee.infoTokens || []).filter((x) => !/^Q[1-3]$/i.test(x) && !/^S\d*$/i.test(x));
}

export function isCleanForPromotion(employee) {
  const tokens = employee.infoTokens || [];
  return !tokens.some((x) => /^(Q[1-3]|A[1-3]|AB\d*|AL\d*)$/i.test(x));
}

export function warningLevel(employee) {
  return Math.min(3, getQLevel(employee) + getALevel(employee));
}

export function warningReason(employee) {
  const q = getQLevel(employee);
  const a = getALevel(employee);
  const parts = [];
  if (q) parts.push(`${q} quota${q > 1 ? 's' : ''} non atteint${q > 1 ? 's' : ''}`);
  if (a) parts.push(`${a} avertissement${a > 1 ? 's' : ''} comportement`);
  return parts.join(' + ') || 'Avertissement actif';
}
