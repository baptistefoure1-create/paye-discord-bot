from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: attendu 1 occurrence, trouvé {count}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label, flags=re.S):
    out, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: remplacement regex impossible ({count})')
    return out


# -----------------------------------------------------------------------------
# 1) Matching réanimations : plus tolérant, mais jamais agressif si ambigu.
# -----------------------------------------------------------------------------
write('src/services/matchingService.js', r'''import { normalizeName, similarity } from '../utils/normalize.js';

function tokens(value) {
  return normalizeName(value).split(' ').filter(Boolean);
}

function unorderedKey(value) {
  return [...tokens(value)].sort((a, b) => a.localeCompare(b, 'fr')).join(' ');
}

function tokenOverlap(a, b) {
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

export function smartNameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (unorderedKey(a) === unorderedKey(b)) return 0.995;

  const ta = tokens(a);
  const tb = tokens(b);
  const base = similarity(a, b);
  const overlap = tokenOverlap(a, b);
  let score = Math.max(base, (base * 0.72) + (overlap * 0.28));

  if (ta.length >= 2 && tb.length >= 2) {
    const first = similarity(ta[0], tb[0]);
    const last = similarity(ta[ta.length - 1], tb[tb.length - 1]);
    if (last >= 0.99 && first >= 0.72) score = Math.max(score, 0.90 + (first * 0.08));
    if (first >= 0.99 && last >= 0.72) score = Math.max(score, 0.90 + (last * 0.08));
  }

  return Math.min(1, score);
}

// V0.2.9 : les correspondances sûres sont automatiques.
// Les vrais anciens noms / wipes / cas ambigus restent à valider dans l'interface Étape 3.
export function matchReanimationsToEmployees(employees, reanimations) {
  const matches = [];
  const anomalies = [];
  const usedEmployeeIds = new Set();

  for (const rea of reanimations) {
    const normalized = normalizeName(rea.name);
    const exact = employees.filter((e) => !e.isWDV && normalizeName(e.name) === normalized);

    if (exact.length === 1) {
      const employee = exact[0];
      if (usedEmployeeIds.has(employee.idUnique)) {
        anomalies.push(`BLOQUANT : plusieurs lignes de réanimations correspondent à ${employee.name} (ID ${employee.idUnique}).`);
      }
      usedEmployeeIds.add(employee.idUnique);
      matches.push({ rea, employee, confidence: 1, ambiguous: false, exact: true });
      continue;
    }

    if (exact.length > 1) {
      matches.push({
        rea,
        employee: null,
        confidence: 1,
        ambiguous: true,
        orphan: true,
        candidates: exact.slice(0, 8).map((employee) => ({ employee, score: 1 })),
      });
      continue;
    }

    const candidates = employees
      .filter((e) => !e.isWDV)
      .map((employee) => ({ employee, score: smartNameSimilarity(rea.name, employee.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const best = candidates[0];
    const second = candidates[1];
    const gap = best ? best.score - (second?.score || 0) : 0;
    const safeMatch = Boolean(best && (
      (best.score >= 0.94 && gap >= 0.12)
      || (best.score >= 0.985 && gap >= 0.05)
    ));

    if (safeMatch && !usedEmployeeIds.has(best.employee.idUnique)) {
      usedEmployeeIds.add(best.employee.idUnique);
      matches.push({
        rea,
        employee: best.employee,
        confidence: best.score,
        ambiguous: false,
        exact: false,
        fuzzyAutomatic: true,
        candidates,
      });
      continue;
    }

    matches.push({
      rea,
      employee: null,
      confidence: best?.score || 0,
      ambiguous: true,
      orphan: true,
      candidates,
    });
  }

  return { matches, anomalies };
}

export function applyReanimationMatches(employees, matches) {
  for (const employee of employees) employee.reanimations = 0;
  for (const match of matches) {
    if (!match.employee) continue;
    match.employee.reanimations = Number(match.employee.reanimations || 0) + Number(match.rea.reanimations || 0);
  }
}
''')


# -----------------------------------------------------------------------------
# 2) Avertissements comportementaux A1/A2/A3.
# -----------------------------------------------------------------------------
write('src/services/warningService.js', r'''function levelFromToken(tokens, prefix) {
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

export function setALevel(employee, level) {
  employee.infoTokens = (employee.infoTokens || []).filter((x) => !/^A[1-3]$/i.test(x));
  if (level > 0) employee.infoTokens.push(`A${Math.min(level, 3)}`);
}

export function incrementALevel(employee) {
  const next = Math.min(3, getALevel(employee) + 1);
  setALevel(employee, next);
  return next;
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
''')


# -----------------------------------------------------------------------------
# 3) Synchronisation des rôles Discord lors des UP / rétrogradations + Averto.
# -----------------------------------------------------------------------------
write('src/services/discordRoleService.js', r'''import { ROLES } from '../config/roles.js';
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
''')


# -----------------------------------------------------------------------------
# 4) Session : stocker avertissements comportementaux + sync de rôles.
# -----------------------------------------------------------------------------
session = read('src/services/sessionService.js')
session = replace_once(
    session,
    "    warnings: [],\n    dismissals: [],",
    "    warnings: [],\n    behaviorWarnings: [],\n    syncedRoleChanges: [],\n    dismissals: [],",
    'session fields',
)
session = replace_once(
    session,
    "    warnings: session.warnings,\n    dismissals: session.dismissals,",
    "    warnings: session.warnings,\n    behaviorWarnings: session.behaviorWarnings || [],\n    syncedRoleChanges: session.syncedRoleChanges || [],\n    dismissals: session.dismissals,",
    'session snapshot',
)
write('src/services/sessionService.js', session)


# -----------------------------------------------------------------------------
# 5) Textes : annonce Discord = rendu Pillbox de base + raison comportement.
# -----------------------------------------------------------------------------
txt = read('src/services/txtGenerator.js')
insert_anchor = "function warningsTxt(session) {"
reason_helper = r'''function warningReasonWithContext(session, employee) {
  const base = warningReason(employee);
  const manual = [...(session.behaviorWarnings || [])]
    .reverse()
    .find((item) => item.employeeId === employee.idUnique && item.reason);
  return manual?.reason ? `${base} — ${manual.reason}` : base;
}

'''
txt = replace_once(txt, insert_anchor, reason_helper + insert_anchor, 'warning helper')
txt = txt.replace('warningReason(e)', 'warningReasonWithContext(session, e)')

announcement = r'''function announcementTxt(session) {
  const fmtMoney = (n) => Math.round(n).toLocaleString('de-DE');
  const lines = [
    `**Bonsoir à tous,** <@&${ROLES.EMPLOYEES}>`,
    '',
    "Une nouvelle semaine commence à l'hôpital Pillbox !",
    '',
    '🏆 **Top 3 de la semaine :**',
  ];

  const medals = ['1️⃣', '2️⃣', '3️⃣'];
  for (const item of session.top3) {
    lines.push(`${medals[item.rank - 1]} ${memberMention(session, item.employeeId, item.name)} gagne une prime de **${fmtMoney(item.bonus)}$** avec **${item.reanimations}** réanimations`);
  }

  lines.push('');
  lines.push(`(Record à battre : ${new Intl.NumberFormat('fr-FR').format(session.record).replace(/\u202f/g, ' ')} réanimations)`);
  if (session.top3[0] && session.top3[0].reanimations > session.record) lines.push('🎉 NOUVEAU RECORD BATTU CETTE SEMAINE !');
  lines.push('');
  lines.push('Les payes de la semaine (ainsi que les Up) seront disponibles **samedi**');
  lines.push("et ce jusqu'à **mercredi**. Après cette date, les payes et UP ne seront");
  lines.push('plus récupérables.');
  lines.push('');
  lines.push(`Si je ne suis pas disponible, n'hésitez pas à ping un <@&${ROLES.HIGH_GRADE}> !`);
  lines.push('');
  lines.push('Bon service à tous !');
  return lines.join('\n');
}
'''
txt = sub_once(
    txt,
    r"function announcementTxt\(session\) \{.*?\n\}\n\nfunction dismissalsTxt",
    announcement + "\nfunction dismissalsTxt",
    'announcement text',
)
write('src/services/txtGenerator.js', txt)


# -----------------------------------------------------------------------------
# 6) Index Discord : Étape 3 en tableau unique, Averto comportement, rôles.
# -----------------------------------------------------------------------------
index = read('src/index.js')
index = replace_once(
    index,
    "import { sendLog } from './services/logService.js';\nimport { registerGuildCommands } from './registerCommands.js';",
    "import { sendLog } from './services/logService.js';\nimport { getALevel, setALevel } from './services/warningService.js';\nimport { syncPendingGradeRoles, syncWarningRoles } from './services/discordRoleService.js';\nimport { registerGuildCommands } from './registerCommands.js';",
    'imports',
)

new_controls = r'''function controlRows(session) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pay:add:ppa').setLabel('Ajouter PPA').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pay:add:bonus').setLabel('Ajouter prime').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pay:add:behavior-warning').setLabel('Averto comportement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('pay:manual:up').setLabel('UP manuelle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('pay:manual:down').setLabel('Rétrogradation').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pay:finalize').setLabel('Terminer la semaine').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pay:cancel').setLabel('Annuler la session').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}
'''
index = sub_once(
    index,
    r"function controlRows\(session\) \{.*?\n\}\n\nfunction reviewEmbed",
    new_controls + "\nfunction reviewEmbed",
    'review controls',
)
index = replace_once(
    index,
    "Toutes les décisions automatiques/validées ont été appliquées. Tu peux encore ajouter une PPA, une prime, une UP manuelle ou une rétrogradation.",
    "Toutes les décisions automatiques/validées ont été appliquées. Tu peux encore ajouter une PPA, une prime, un avertissement comportemental, une UP manuelle ou une rétrogradation.",
    'review description',
)
index = replace_once(
    index,
    "async function sendCurrentStep(thread, session, interaction = null) {\n  const question = currentQuestion(session);",
    "async function sendCurrentStep(thread, session, interaction = null) {\n  await syncPendingGradeRoles(thread.guild, session).catch(() => null);\n  const question = currentQuestion(session);",
    'role sync on workflow',
)

step3_block = r'''function step3SelectedReaItem(session) {
  const index = Number(session.selectedReaMatchIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const item = session.reaMatches?.[index];
  return (session.reaResolutionQueue || []).includes(item) ? item : null;
}

function step3Cell(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text.padEnd(max, ' ');
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function step3ResolutionPayload(session) {
  const queue = session.reaResolutionQueue || [];
  const selected = step3SelectedReaItem(session);
  const rows = queue.slice(0, 25).map((item, i) => {
    const best = (item.candidates || [])[0];
    const suggestion = best?.employee
      ? `${best.employee.name} ${Math.round((best.score || 0) * 100)}%`
      : 'Aucune';
    return `${String(i + 1).padStart(2, ' ')}  ${step3Cell(item.rea.name, 22)} ${String(item.rea.reanimations || 0).padStart(4, ' ')}  ${step3Cell(suggestion, 28)}`;
  });
  const table = ['#   Nom réanimations          Réa  Meilleure suggestion', ...rows].join('\n');
  const more = queue.length > 25 ? `\n… +${queue.length - 25} autre(s) nom(s), affichés après résolution des premiers.` : '';

  const orphanOptions = queue.slice(0, 25).map((item) => {
    const index = session.reaMatches.indexOf(item);
    const best = (item.candidates || [])[0];
    return {
      label: `${item.rea.name} — ${item.rea.reanimations || 0} réa`.slice(0, 100),
      description: best?.employee
        ? `Suggestion : ${best.employee.name} (${Math.round((best.score || 0) * 100)}%)`.slice(0, 100)
        : 'Aucune suggestion sûre',
      value: String(index),
    };
  });

  const chooseRow = new StringSelectMenuBuilder()
    .setCustomId('pay:resolve:rea:pick')
    .setPlaceholder('Choisir un nom du tableau à traiter')
    .addOptions(orphanOptions);

  const components = [new ActionRowBuilder().addComponents(chooseRow)];

  if (selected) {
    const candidates = (selected.candidates || [])
      .filter((candidate) => candidate.employee && !candidate.employee.isWDV)
      .slice(0, 24)
      .map((candidate) => ({
        label: `${candidate.employee.name} [${candidate.employee.grade}]`.slice(0, 100),
        description: `ID ${candidate.employee.idUnique} · suggestion ${Math.round((candidate.score || 0) * 100)}%`.slice(0, 100),
        value: candidate.employee.idUnique,
      }));
    candidates.push({
      label: 'Pas / plus EMS',
      description: 'Ignorer ce nom : il ne correspond à aucun EMS actuel',
      value: '__IGNORE__',
    });
    const target = new StringSelectMenuBuilder()
      .setCustomId('pay:resolve:rea:target')
      .setPlaceholder(`Associer ${selected.rea.name}`.slice(0, 150))
      .addOptions(candidates);
    components.push(new ActionRowBuilder().addComponents(target));
  }

  const manual = new ButtonBuilder()
    .setCustomId('pay:resolve:rea:manual')
    .setLabel('Choisir un autre EMS')
    .setEmoji('🔎')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!selected);
  const ignore = new ButtonBuilder()
    .setCustomId('pay:resolve:rea:ignore')
    .setLabel('Pas / plus EMS')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!selected);
  const skipRest = new ButtonBuilder()
    .setCustomId('pay:resolve:rea:skipall')
    .setLabel('Ignorer tous les restants')
    .setEmoji('⏭️')
    .setStyle(ButtonStyle.Secondary);
  const cancel = new ButtonBuilder()
    .setCustomId('pay:cancel')
    .setLabel('Annuler')
    .setEmoji('❌')
    .setStyle(ButtonStyle.Danger);
  components.push(new ActionRowBuilder().addComponents(manual, ignore, skipRest, cancel));

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle('Étape 3 — Wipe / changement de nom')
        .setDescription(
          `Tous les noms réellement non reconnus sont regroupés ici. Tu n'as plus une question différente pour chaque personne.\n\n` +
          '```text\n' + table.slice(0, 3000) + more + '\n```\n' +
          (selected
            ? `**Sélection :** ${selected.rea.name} — **${selected.rea.reanimations || 0} réanimations**\nChoisis l’EMS actuel dans la liste, **Pas / plus EMS**, ou **Choisir un autre EMS**.`
            : 'Choisis simplement une ligne du tableau ci-dessous pour la résoudre.'),
        )
        .setFooter({ text: `${queue.length} nom(s) à résoudre · une seule carte se met à jour` }),
    ],
    components,
  };
}

async function sendNextReaResolution(thread, session) {
  const queue = session.reaResolutionQueue || [];
  if (!queue.length) {
    session.selectedReaMatchIndex = null;
    applyReanimationMatches(session.employees, session.reaMatches);
    await startBusinessWorkflow(thread, session, thread.guild);
    return;
  }

  session.stage = 'resolve_rea';
  const payload = step3ResolutionPayload(session);
  if (session.stage3MessageId) {
    const existing = await thread.messages.fetch(session.stage3MessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return;
    }
  }
  const sent = await thread.send(payload);
  session.stage3MessageId = sent.id;
  session.workflowMessageId = sent.id;
}
'''
index = sub_once(
    index,
    r"async function sendNextReaResolution\(thread, session\) \{.*?\n\}\n\nasync function sendNextDiscordResolution",
    step3_block + "\nasync function sendNextDiscordResolution",
    'step3 card',
)

# Modale d'avertissement comportemental.
behavior_modal = r'''function behaviorWarningModal() {
  const modal = new ModalBuilder().setCustomId('pay:modal:behavior-warning').setTitle('Avertissement comportemental');
  const employee = new TextInputBuilder()
    .setCustomId('employee')
    .setLabel('Nom RP ou ID unique')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Raison (optionnel)')
    .setPlaceholder('Ex : comportement en service, non-respect des consignes…')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300);
  modal.addComponents(
    new ActionRowBuilder().addComponents(employee),
    new ActionRowBuilder().addComponents(reason),
  );
  return modal;
}

'''
index = replace_once(index, 'function correctionModal(customId, title, fieldLabel, placeholder = \'\') {', behavior_modal + 'function correctionModal(customId, title, fieldLabel, placeholder = \'\') {', 'behavior modal')

# Boutons Étape 3 : manuel + ignorer la ligne sélectionnée.
old_manual_button = r'''      if (interaction.customId === 'pay:resolve:rea:manual') {
        if (session.stage !== 'resolve_rea') return interaction.reply({ content: 'Cette action n’est disponible qu’à l’étape 3.', ephemeral: true });
        return interaction.showModal(stage3ManualLinkModal());
      }
'''
new_manual_button = r'''      if (interaction.customId === 'pay:resolve:rea:manual') {
        if (session.stage !== 'resolve_rea') return interaction.reply({ content: 'Cette action n’est disponible qu’à l’étape 3.', ephemeral: true });
        if (!step3SelectedReaItem(session)) return interaction.reply({ content: 'Choisis d’abord une ligne dans le tableau.', ephemeral: true });
        return interaction.showModal(stage3ManualLinkModal());
      }

      if (interaction.customId === 'pay:resolve:rea:ignore') {
        if (session.stage !== 'resolve_rea') return interaction.reply({ content: 'Cette action n’est disponible qu’à l’étape 3.', ephemeral: true });
        const item = step3SelectedReaItem(session);
        if (!item) return interaction.reply({ content: 'Choisis d’abord une ligne dans le tableau.', ephemeral: true });
        item.employee = null;
        item.ambiguous = false;
        session.ignoredReaNames ??= [];
        session.ignoredReaNames.push(item.rea.name);
        session.reaResolutionQueue = (session.reaResolutionQueue || []).filter((x) => x !== item);
        session.selectedReaMatchIndex = null;
        await interaction.deferUpdate();
        await logAction(session, interaction, 'Étape 3 : pas / plus EMS', null, item.rea.name);
        await sendNextReaResolution(interaction.channel, session);
        return;
      }
'''
index = replace_once(index, old_manual_button, new_manual_button, 'step3 manual button')
index = replace_once(
    index,
    "        session.reaResolutionQueue = [];\n        await interaction.deferUpdate();",
    "        session.reaResolutionQueue = [];\n        session.selectedReaMatchIndex = null;\n        await interaction.deferUpdate();",
    'step3 skip all selection',
)

# Les deux menus de la carte Étape 3 remplacent l'ancien menu séquentiel.
step3_select_handlers = r'''    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:resolve:rea:pick') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_rea') return interaction.reply({ content: 'L’étape 3 n’est plus active.', ephemeral: true });
      const index = Number(interaction.values[0]);
      const item = session.reaMatches?.[index];
      if (!item || !(session.reaResolutionQueue || []).includes(item)) return interaction.reply({ content: 'Cette ligne a déjà été traitée.', ephemeral: true });
      session.selectedReaMatchIndex = index;
      await interaction.update(step3ResolutionPayload(session));
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:resolve:rea:target') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_rea') return interaction.reply({ content: 'L’étape 3 n’est plus active.', ephemeral: true });
      const item = step3SelectedReaItem(session);
      if (!item) return interaction.reply({ content: 'Sélection expirée : choisis de nouveau une ligne.', ephemeral: true });
      const value = interaction.values[0];
      if (value === '__IGNORE__') {
        item.employee = null;
        session.ignoredReaNames ??= [];
        session.ignoredReaNames.push(item.rea.name);
      } else {
        const employee = session.employees.find((e) => e.idUnique === value && !e.isWDV);
        if (!employee) return interaction.reply({ content: 'EMS introuvable.', ephemeral: true });
        item.employee = employee;
      }
      item.ambiguous = false;
      session.reaResolutionQueue = (session.reaResolutionQueue || []).filter((x) => x !== item);
      session.selectedReaMatchIndex = null;
      await interaction.deferUpdate();
      await logAction(session, interaction, 'Étape 3 : correspondance réanimations', item.employee, `${item.rea.name} → ${item.employee?.name || 'pas/plus EMS'}`);
      await sendNextReaResolution(interaction.channel, session);
      return;
    }

'''
index = sub_once(
    index,
    r"    if \(interaction\.isStringSelectMenu\(\) && interaction\.customId === 'pay:resolve:rea'\) \{.*?\n    \}\n\n    if \(interaction\.isStringSelectMenu\(\) && interaction\.customId === 'pay:resolve:discord'\) \{",
    step3_select_handlers + "    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:resolve:discord') {",
    'step3 select handlers',
)

# La modale « autre EMS » travaille maintenant sur la ligne sélectionnée du tableau.
manual_modal_handler = r'''    if (interaction.isModalSubmit() && interaction.customId === 'pay:modal:resolve-rea-manual') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_rea') return interaction.reply({ content: 'L’étape 3 n’est plus active.', ephemeral: true });
      const item = step3SelectedReaItem(session);
      if (!item) return interaction.reply({ content: 'Sélection expirée : choisis de nouveau une ligne du tableau.', ephemeral: true });
      const employee = employeeByName(session, interaction.fields.getTextInputValue('employee'));
      if (!employee || employee.isWDV) return interaction.reply({ content: '❌ EMS introuvable ou WDV. Utilise son nom RP actuel ou son ID unique.', ephemeral: true });
      item.employee = employee;
      item.ambiguous = false;
      session.reaResolutionQueue = (session.reaResolutionQueue || []).filter((x) => x !== item);
      session.selectedReaMatchIndex = null;
      await interaction.reply({ content: `✅ **${item.rea.name}** (${item.rea.reanimations} réa) lié à **${employee.name}**.`, ephemeral: true });
      await logAction(session, interaction, 'Étape 3 : lien manuel ancien nom', employee, `${item.rea.name} → ${employee.name}`);
      await sendNextReaResolution(interaction.channel, session);
      return;
    }

'''
index = sub_once(
    index,
    r"    if \(interaction\.isModalSubmit\(\) && interaction\.customId === 'pay:modal:resolve-rea-manual'\) \{.*?\n    \}\n\n    if \(interaction\.isModalSubmit\(\) && \['pay:modal:editrea', 'pay:modal:editinfo', 'pay:modal:editpay'\]\.includes\(interaction\.customId\)\) \{",
    manual_modal_handler + "    if (interaction.isModalSubmit() && ['pay:modal:editrea', 'pay:modal:editinfo', 'pay:modal:editpay'].includes(interaction.customId)) {",
    'step3 manual modal',
)

# Bouton Averto comportement au récapitulatif.
index = replace_once(
    index,
    "      if (interaction.customId === 'pay:manual:down') return interaction.showModal(gradeModal('pay:modal:down', 'Rétrogradation manuelle', 'Grade cible inférieur'));",
    "      if (interaction.customId === 'pay:manual:down') return interaction.showModal(gradeModal('pay:modal:down', 'Rétrogradation manuelle', 'Grade cible inférieur'));\n      if (interaction.customId === 'pay:add:behavior-warning') return interaction.showModal(behaviorWarningModal());",
    'behavior button handler',
)

# Traitement de la modale comportementale dans les actions finales.
behavior_handler = r'''
      if (interaction.customId === 'pay:modal:behavior-warning') {
        const currentLevel = getALevel(employee);
        const nextLevel = Math.min(3, currentLevel + 1);
        setALevel(employee, nextLevel);
        const reason = interaction.fields.getTextInputValue('reason').trim();
        session.behaviorWarnings ??= [];
        session.behaviorWarnings.push({
          employeeId: employee.idUnique,
          name: employee.name,
          level: nextLevel,
          reason,
          managerId: interaction.user.id,
          createdAt: Date.now(),
        });
        refreshWarnings(session);
        await syncWarningRoles(interaction.guild, session).catch(() => null);
        await interaction.reply({ content: `✅ Avertissement comportemental : **${employee.name} → A${nextLevel}**${reason ? ` — ${reason}` : ''}`, ephemeral: true });
        await logAction(session, interaction, 'Avertissement comportemental', employee, `A${nextLevel}${reason ? ` — ${reason}` : ''}`);
        await sendCurrentStep(interaction.channel, session);
        return;
      }
'''
index = sub_once(
    index,
    r"(    if \(interaction\.isModalSubmit\(\) && interaction\.customId\.startsWith\('pay:modal:'\)\) \{.*?      const employee = employeeByName\(session, interaction\.fields\.getTextInputValue\('employee'\)\);\n      if \(!employee \|\| employee\.isWDV\) return interaction\.reply\(\{ content: '❌ Employé introuvable ou WDV\. Utilise le nom RP exact ou l’ID unique\.', ephemeral: true \}\);)",
    r"\1" + behavior_handler,
    'behavior modal handler',
)

# Synchroniser les rôles Averto/grades lors de la finalisation aussi (sécurité).
index = sub_once(
    index,
    r"(      if \(interaction\.customId === 'pay:finalize'\) \{.*?        computeTop3\(session\);\n        refreshWarnings\(session\);)",
    r"\1\n        await syncPendingGradeRoles(interaction.guild, session).catch(() => null);\n        await syncWarningRoles(interaction.guild, session).catch(() => null);",
    'final role sync',
)
write('src/index.js', index)


# -----------------------------------------------------------------------------
# 7) Version, changelog et tests supplémentaires.
# -----------------------------------------------------------------------------
package = json.loads(read('package.json'))
package['version'] = '0.2.9'
package['description'] = 'Bot Discord de gestion des payes EMS - V0.2.9 interface rapide'
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')

write('CHANGELOG_V0_2_9.txt', '''PILLBOX PAIE TEST - V0.2.9\n==============================\n\n- Étape 3 refondue en tableau/interface Discord unique.\n- Les noms très proches et non ambigus sont rapprochés automatiquement.\n- Les vrais anciens noms/wipes restent à valider manuellement.\n- Ajout d'un avertissement comportemental manuel A1/A2/A3.\n- Synchronisation automatique des rôles Discord lors des UP/rétrogradations.\n- Synchronisation des rôles Averto 1/2/3.\n- Annonce Discord remise au format Pillbox de base (samedi → mercredi).\n- Les anciens flux et les 6 TXT restent conservés.\n''')

write('tests/v029-improvements.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReanimationsToEmployees } from '../src/services/matchingService.js';
import { getALevel, setALevel, incrementALevel } from '../src/services/warningService.js';

test('V0.2.9 : un prénom/nom inversé est reconnu automatiquement', () => {
  const employees = [{ idUnique: '1', name: 'Baptiste Fore', grade: 'ADD', isWDV: false }];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Fore Baptiste', reanimations: 70 }]);
  assert.equal(out.matches[0].employee?.idUnique, '1');
  assert.equal(out.matches[0].ambiguous, false);
});

test('V0.2.9 : une petite faute évidente peut être reconnue automatiquement', () => {
  const employees = [
    { idUnique: '1', name: 'Baptiste Fore', grade: 'ADD', isWDV: false },
    { idUnique: '2', name: 'Pablo O Connor', grade: 'M', isWDV: false },
  ];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Baptiste Foure', reanimations: 70 }]);
  assert.equal(out.matches[0].employee?.idUnique, '1');
  assert.equal(out.matches[0].ambiguous, false);
});

test('V0.2.9 : un ancien nom ambigu reste à valider', () => {
  const employees = [
    { idUnique: '247144', name: 'Simonee Babidi', grade: 'M', isWDV: false },
    { idUnique: '94192', name: 'Kelly Guzman', grade: 'A', isWDV: false },
  ];
  const out = matchReanimationsToEmployees(employees, [{ name: 'Simonee Gusman', reanimations: 38 }]);
  assert.equal(out.matches[0].employee, null);
  assert.equal(out.matches[0].ambiguous, true);
});

test('V0.2.9 : avertissement comportemental A1/A2/A3', () => {
  const employee = { infoTokens: [] };
  setALevel(employee, 1);
  assert.equal(getALevel(employee), 1);
  assert.equal(incrementALevel(employee), 2);
  assert.equal(incrementALevel(employee), 3);
  assert.equal(incrementALevel(employee), 3);
  assert.equal(getALevel(employee), 3);
});
''')

print('Patch V0.2.9 appliqué.')
