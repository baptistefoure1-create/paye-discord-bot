import { ROLES } from '../config/roles.js';
import { GRADE_ORDER } from '../config/payroll.js';
import { warningLevel } from './warningService.js';

const GRADE_ROLE_IDS = GRADE_ORDER.map((grade) => ROLES[grade]).filter(Boolean);
const WARNING_ROLE_IDS = [ROLES.WARNING_1, ROLES.WARNING_2, ROLES.WARNING_3].filter(Boolean);

async function memberForEmployee(guild, session, employeeId) {
  const memberId = session.memberMatches?.get?.(employeeId)?.memberId;
  if (!memberId) return null;
  return guild.members.fetch(memberId).catch(() => null);
}

export async function syncEmployeeGradeRole(guild, session, employee, targetGrade) {
  if (!guild || !employee || !ROLES[targetGrade]) return { ok: false, reason: 'grade-role-missing' };
  const member = await memberForEmployee(guild, session, employee.idUnique);
  if (!member) return { ok: false, reason: 'member-not-linked' };

  try {
    const targetRoleId = ROLES[targetGrade];
    const removable = GRADE_ROLE_IDS.filter((roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId));
    if (removable.length) await member.roles.remove(removable, `Pillbox Paie : passage vers ${targetGrade}`);
    if (!member.roles.cache.has(targetRoleId)) await member.roles.add(targetRoleId, `Pillbox Paie : passage vers ${targetGrade}`);
    return { ok: true, memberId: member.id, targetGrade };
  } catch (error) {
    console.error(`[roles] Impossible de synchroniser ${employee.name} vers ${targetGrade}:`, error?.message || error);
    return { ok: false, reason: error?.message || 'discord-error' };
  }
}

export async function syncPendingGradeRoles(guild, session) {
  session.syncedRoleChanges ??= [];
  const done = new Set(session.syncedRoleChanges);
  const changes = [
    ...(session.promotions || []).map((x) => ({ ...x, kind: 'up' })),
    ...(session.demotions || []).map((x) => ({ ...x, kind: 'down' })),
  ];
  const results = [];

  for (const change of changes) {
    const key = `${change.kind}:${change.employeeId}:${change.from}->${change.to}`;
    if (done.has(key)) continue;
    const employee = session.employees.find((e) => e.idUnique === change.employeeId);
    if (!employee) continue;
    const result = await syncEmployeeGradeRole(guild, session, employee, change.to);
    results.push({ ...result, key, employeeId: employee.idUnique, name: employee.name });
    if (result.ok) {
      session.syncedRoleChanges.push(key);
      done.add(key);
    }
  }
  return results;
}

export async function syncWarningRoles(guild, session) {
  const results = [];
  for (const employee of session.employees || []) {
    const member = await memberForEmployee(guild, session, employee.idUnique);
    if (!member) continue;
    const level = (!employee.isWDV && !employee.dismissed) ? warningLevel(employee) : 0;
    const wantedRoleId = level > 0 ? ROLES[`WARNING_${Math.min(level, 3)}`] : null;
    try {
      const remove = WARNING_ROLE_IDS.filter((roleId) => roleId !== wantedRoleId && member.roles.cache.has(roleId));
      if (remove.length) await member.roles.remove(remove, 'Pillbox Paie : synchronisation avertissement');
      if (wantedRoleId && !member.roles.cache.has(wantedRoleId)) {
        await member.roles.add(wantedRoleId, `Pillbox Paie : Averto ${Math.min(level, 3)}`);
      }
      results.push({ ok: true, employeeId: employee.idUnique, level });
    } catch (error) {
      console.error(`[roles] Impossible de synchroniser l'avertissement de ${employee.name}:`, error?.message || error);
      results.push({ ok: false, employeeId: employee.idUnique, level, reason: error?.message || 'discord-error' });
    }
  }
  return results;
}
