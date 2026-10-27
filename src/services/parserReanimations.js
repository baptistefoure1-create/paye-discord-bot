export function parseReanimations(raw) {
  const results = [];
  const anomalies = [];
  const lines = String(raw || '').split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!/réanimations?\s*:/i.test(line)) continue;
    const m = line.match(/^\s*\d+\.\s*(.+?)\s*[—–-]\s*Réanimations?\s*:\s*(-?\d+)/i);
    if (!m) {
      anomalies.push(`Ligne réanimations ${index + 1} non reconnue : ${line.slice(0, 180)}`);
      continue;
    }
    const reanimations = Number(m[2]);
    if (!Number.isFinite(reanimations) || reanimations < 0) {
      anomalies.push(`Réanimations invalides ligne ${index + 1} : ${line.slice(0, 180)}`);
      continue;
    }
    results.push({
      name: m[1].trim(),
      reanimations,
      sourceLine: line,
    });
  }

  return { results, anomalies };
}
