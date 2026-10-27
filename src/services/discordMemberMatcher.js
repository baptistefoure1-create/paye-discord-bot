import { normalizeName, similarity } from '../utils/normalize.js';

function nameVariants(value) {
  const raw = String(value || '').trim();
  const withoutGrade = raw
    .replace(/^[.\s]*(?:\[[^\]]+\]\s*)+/u, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  return Array.from(new Set([raw, withoutGrade].filter(Boolean)));
}

function candidateNames(member) {
  return [member.displayName, member.user.globalName, member.user.username]
    .filter(Boolean)
    .flatMap(nameVariants);
}

export async function matchDiscordMembers(guild, employees) {
  await guild.members.fetch().catch(() => null);
  const members = [...guild.members.cache.values()].filter((m) => !m.user.bot);
  const result = new Map();

  for (const employee of employees) {
    const target = normalizeName(employee.name);
    const exact = members.filter((m) => candidateNames(m).some((name) => normalizeName(name) === target));

    if (exact.length === 1) {
      result.set(employee.idUnique, {
        memberId: exact[0].id,
        ambiguous: false,
        status: 'linked',
        confidence: 1,
        matchedBy: 'exact',
      });
      continue;
    }

    if (exact.length > 1) {
      result.set(employee.idUnique, {
        memberId: null,
        ambiguous: true,
        status: 'ambiguous',
        confidence: 1,
        candidates: exact.slice(0, 10).map((m) => ({ id: m.id, name: m.displayName, score: 1 })),
      });
      continue;
    }

    const scored = members
      .map((m) => {
        const names = candidateNames(m);
        const score = Math.max(...names.map((name) => similarity(employee.name, name)), 0);
        return { member: m, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];

    // V0.2 : un nom non suffisamment sûr est simplement considéré comme
    // "absent du serveur / sans ping". Il ne doit plus ralentir l'étape 3.
    if (!best || best.score < 0.90) {
      result.set(employee.idUnique, {
        memberId: null,
        ambiguous: false,
        status: 'missing',
        confidence: best?.score || 0,
      });
      continue;
    }

    // On ne demande une validation que si DEUX comptes sont réellement très proches.
    if (second && second.score >= 0.90 && Math.abs(best.score - second.score) < 0.07) {
      result.set(employee.idUnique, {
        memberId: null,
        ambiguous: true,
        status: 'ambiguous',
        confidence: best.score,
        candidates: scored.slice(0, 5).map((x) => ({ id: x.member.id, name: x.member.displayName, score: x.score })),
      });
      continue;
    }

    result.set(employee.idUnique, {
      memberId: best.member.id,
      ambiguous: false,
      status: 'linked',
      confidence: best.score,
      matchedBy: 'fuzzy',
    });
  }

  return result;
}
