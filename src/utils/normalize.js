export function stripDiacritics(value = '') {
  return String(value).normalize('NFKD').replace(/\p{Diacritic}/gu, '');
}

export function normalizeName(value = '') {
  return stripDiacritics(String(value))
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[_–—-]+/g, ' ')
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a = '', b = '') {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s) return t.length;
  if (!t) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[s.length][t.length];
}

export function similarity(a = '', b = '') {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}
