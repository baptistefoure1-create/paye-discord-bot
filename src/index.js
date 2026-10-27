import 'dotenv/config';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { CHANNELS } from './config/channels.js';
import { ROLES, hasPayrollManagerRole } from './config/roles.js';
import { GRADE_ORDER, GRADE_LABELS, PPA_WEEKLY_CAP } from './config/payroll.js';
import { parseDateFR, formatDateFR } from './utils/dates.js';
import { formatMoney, parseMoney } from './utils/money.js';
import {
  getActiveSession, createSession, clearSession, appendRaw, restoreSnapshot,
} from './services/sessionService.js';
import { parseEMS } from './services/parserEMS.js';
import { parseReanimations } from './services/parserReanimations.js';
import { matchReanimationsToEmployees, applyReanimationMatches } from './services/matchingService.js';
import { matchDiscordMembers } from './services/discordMemberMatcher.js';
import {
  initializeQuestions, currentQuestion, questionComponents, questionEmbed, applyAnswer,
} from './services/questionService.js';
import {
  calculateEmployeePay, computeTop3, refreshWarnings, isBnvl,
} from './services/payrollRules.js';
import { higherGrades, lowerGrades } from './services/promotionService.js';
import {
  generateSixTxt, buildWarningDiscordMessage, buildAnnouncementDiscordMessage,
} from './services/txtGenerator.js';
import { sendLog } from './services/logService.js';
import { registerGuildCommands } from './registerCommands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('DISCORD_TOKEN, CLIENT_ID et GUILD_ID sont requis dans les variables d\'environnement.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

function managerGuard(interaction) {
  if (!interaction.inGuild() || !hasPayrollManagerRole(interaction.member)) {
    interaction.reply({ content: '❌ Cette action est réservée aux ADD, CD, D et DG.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

function sessionGuard(interaction, { allowFinalized = false } = {}) {
  const session = getActiveSession();
  if (!session) {
    interaction.reply({ content: '❌ Aucune session de paie active.', ephemeral: true }).catch(() => {});
    return null;
  }
  if (!allowFinalized && session.finalized) {
    interaction.reply({ content: '🔒 Cette session est finalisée.', ephemeral: true }).catch(() => {});
    return null;
  }
  return session;
}

function sameThread(interaction, session) {
  return interaction.channelId === session.threadId || interaction.channelId === CHANNELS.PAYROLL;
}

function startModal() {
  const modal = new ModalBuilder()
    .setCustomId('pay:start:modal')
    .setTitle('Nouvelle semaine de paie');

  const start = new TextInputBuilder()
    .setCustomId('week_start')
    .setLabel('Début de semaine (JJ/MM/AAAA)')
    .setPlaceholder('17/10/2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const end = new TextInputBuilder()
    .setCustomId('week_end')
    .setLabel('Fin de semaine (JJ/MM/AAAA)')
    .setPlaceholder('23/10/2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const record = new TextInputBuilder()
    .setCustomId('record')
    .setLabel('Record actuel (réanimations)')
    .setPlaceholder('1732')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(start),
    new ActionRowBuilder().addComponents(end),
    new ActionRowBuilder().addComponents(record),
  );
  return modal;
}

function controlRows(session) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pay:add:ppa').setLabel('Ajouter PPA').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pay:add:bonus').setLabel('Ajouter prime').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pay:manual:up').setLabel('UP manuelle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('pay:manual:down').setLabel('Rétrogradation').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pay:finalize').setLabel('Terminer la semaine').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pay:cancel').setLabel('Annuler la session').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

function reviewEmbed(session) {
  computeTop3(session);
  refreshWarnings(session);
  const ppaCount = Object.values(session.ppa).filter((v) => Number(v) > 0).length;
  const bonusCount = Object.values(session.optionalBonuses).filter((v) => Number(v) > 0).length;

  return new EmbedBuilder()
    .setColor(0x0f766e)
    .setTitle('Récapitulatif avant finalisation')
    .setDescription('Toutes les décisions automatiques/validées ont été appliquées. Tu peux encore ajouter une PPA, une prime, une UP manuelle ou une rétrogradation.')
    .addFields(
      { name: 'Employés actifs', value: String(session.employees.filter((e) => !e.isWDV && !e.dismissed).length), inline: true },
      { name: 'Avertissements actifs', value: String(session.warnings.length), inline: true },
      { name: 'Promotions', value: String(session.promotions.length), inline: true },
      { name: 'Rétrogradations', value: String(session.demotions.length), inline: true },
      { name: 'Licenciements', value: String(session.dismissals.length), inline: true },
      { name: 'PPA', value: String(ppaCount), inline: true },
      { name: 'Primes optionnelles', value: String(bonusCount), inline: true },
      {
        name: 'Top 3',
        value: session.top3.length
          ? session.top3.map((x) => `${x.rank}. ${x.name} — ${x.reanimations} réanimations`).join('\n')
          : '—',
        inline: false,
      },
      {
        name: 'Anomalies',
        value: session.anomalies.length ? session.anomalies.slice(0, 8).map((x) => `• ${x}`).join('\n').slice(0, 1024) : 'Aucune anomalie bloquante.',
        inline: false,
      },
    );
}

function currentStepPayload(session) {
  if (session.stage === 'review') {
    return { embeds: [reviewEmbed(session)], components: controlRows(session) };
  }

  const question = currentQuestion(session);
  if (!question && (session.stage === 'decisions' || session.stage === 'near_quota' || session.stage === 'top3_ties')) {
    session.stage = 'review';
    return { embeds: [reviewEmbed(session)], components: controlRows(session) };
  }
  if (!question) return null;
  return {
    embeds: [questionEmbed(question, session.currentQuestionIndex, session.questions.length)],
    components: questionComponents(question),
  };
}

async function sendCurrentStep(thread, session, interaction = null) {
  const question = currentQuestion(session);
  if (question) {
    session.loggedQuestionIds ??= new Set();
    if (!session.loggedQuestionIds.has(question.id)) {
      session.loggedQuestionIds.add(question.id);
      const employee = session.employees.find((e) => e.idUnique === question.employeeId);
      const label = question.type === 'promote' || question.type === 'specialize' ? 'UP proposée'
        : question.type === 'q_confirm' ? 'Q proposé'
        : question.type === 'dismiss' ? 'Licenciement proposé'
        : question.type === 'near_quota' ? 'Quota presque atteint proposé'
        : question.type === 'top3_tie' ? 'Égalité Top 3 à départager'
        : 'Décision proposée';
      await sendLog(client, session, label, { employee, details: question.prompt }).catch(() => null);
    }
  }

  const payload = currentStepPayload(session);
  if (!payload) return;

  // V0.2 : toute la phase de décisions réutilise UNE seule carte Discord.
  // Le thread ne se remplit plus d'un nouveau message à chaque clic.
  if (interaction?.isMessageComponent?.()) {
    session.workflowMessageId = interaction.message.id;
    await interaction.update(payload);
    return;
  }

  if (session.workflowMessageId) {
    const existing = await thread.messages.fetch(session.workflowMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return;
    }
  }

  const sent = await thread.send(payload);
  session.workflowMessageId = sent.id;
}


async function startBusinessWorkflow(thread, session, guild) {
  const matchedIds = (session.reaMatches || []).filter((m) => m.employee).map((m) => m.employee.idUnique);
  const duplicateMatches = [...new Set(matchedIds.filter((id, i) => matchedIds.indexOf(id) !== i))];
  if (duplicateMatches.length) {
    session.anomalies.push(...duplicateMatches.map((id) => `BLOQUANT : plusieurs lignes de réanimations sont attribuées à l'ID ${id}.`));
  }

  // Les comptes Discord servent seulement aux pings. Un EMS non trouvé n'est PAS une anomalie :
  // on considère simplement qu'il n'est pas sur le serveur test / qu'il ne doit pas être ping.
  session.memberMatches = await matchDiscordMembers(guild, session.employees);
  session.discordResolutionQueue = [...session.memberMatches.entries()]
    .filter(([, match]) => match?.ambiguous)
    .map(([employeeId, match]) => ({ employeeId, ...match }));

  session.stage = 'preanalysis';
  await sendPreanalysis(thread, session, { replace: Boolean(session.stage3MessageId) });
}

async function sendNextReaResolution(thread, session) {
  const item = session.reaResolutionQueue?.[0];
  if (!item) {
    applyReanimationMatches(session.employees, session.reaMatches);
    await startBusinessWorkflow(thread, session, thread.guild);
    return;
  }

  const total = session.reaResolutionTotal || session.reaResolutionQueue.length;
  session.reaResolutionTotal = total;
  const current = total - session.reaResolutionQueue.length + 1;

  const candidates = (item.candidates || [])
    .filter((candidate) => candidate.employee && !candidate.employee.isWDV)
    .slice(0, 10);

  const options = candidates.map((candidate) => ({
    label: `${candidate.employee.name} [${candidate.employee.grade}]`.slice(0, 100),
    description: `ID ${candidate.employee.idUnique} · suggestion ${Math.round(candidate.score * 100)}%`.slice(0, 100),
    value: candidate.employee.idUnique,
  }));
  options.push({
    label: 'Pas / plus EMS',
    description: 'Ce nom des réanimations ne correspond à aucun EMS actuel',
    value: '__IGNORE__',
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('pay:resolve:rea')
    .setPlaceholder('Ancien nom → EMS actuel, ou Pas / plus EMS')
    .addOptions(options);

  const manual = new ButtonBuilder()
    .setCustomId('pay:resolve:rea:manual')
    .setLabel('Choisir un autre EMS')
    .setEmoji('🔎')
    .setStyle(ButtonStyle.Primary);

  const skipRest = new ButtonBuilder()
    .setCustomId('pay:resolve:rea:skipall')
    .setLabel('Ignorer tous les noms restants')
    .setEmoji('⏭️')
    .setStyle(ButtonStyle.Secondary);

  const cancel = new ButtonBuilder()
    .setCustomId('pay:cancel')
    .setLabel('Annuler')
    .setEmoji('❌')
    .setStyle(ButtonStyle.Danger);

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle('Étape 3 — Wipe / changement de nom')
        .setDescription(
          `**Nom non reconnu dans le tableau EMS :**\n${item.rea.name} — **${item.rea.reanimations} réanimations**\n\n` +
          `S'il s'agit d'un ancien nom / wipe, sélectionne l'EMS actuel.\n` +
          `Si cette personne n'est plus EMS, choisis **Pas / plus EMS**.\n\n` +
          `ℹ️ Les employés EMS qui ne sont reliés à aucun ancien nom restent simplement EMS : il n'y a rien à leur assigner.`,
        )
        .setFooter({ text: `Nom orphelin ${current}/${total} · seuls les noms réellement non reconnus sont affichés` }),
    ],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(manual, skipRest, cancel),
    ],
  };

  if (session.stage3MessageId) {
    const existing = await thread.messages.fetch(session.stage3MessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return;
    }
  }
  const sent = await thread.send(payload);
  session.stage3MessageId = sent.id;
}

async function sendNextDiscordResolution(thread, session) {
  const item = session.discordResolutionQueue?.[0];
  if (!item) {
    session.stage = 'preanalysis';
    await sendPreanalysis(thread, session, { replace: true });
    return;
  }

  const employee = session.employees.find((e) => e.idUnique === item.employeeId);
  const options = (item.candidates || []).slice(0, 20).map((candidate) => ({
    label: candidate.name.slice(0, 100),
    description: `Discord ID ${candidate.id}${candidate.score ? ` · ${Math.round(candidate.score * 100)}%` : ''}`.slice(0, 100),
    value: candidate.id,
  }));
  options.push({ label: 'Aucun compte / pas de ping', value: '__NONE__' });

  const select = new StringSelectMenuBuilder()
    .setCustomId('pay:resolve:discord')
    .setPlaceholder('Choisir le compte Discord')
    .addOptions(options);

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle('Pings Discord — correspondance ambiguë')
        .setDescription(`Plusieurs comptes ressemblent à **${employee?.name || item.employeeId}**.\nChoisis le bon uniquement si tu veux le ping. Sinon choisis **Aucun compte / pas de ping**.`),
    ],
    components: [new ActionRowBuilder().addComponents(select)],
  };

  if (session.stage3MessageId) {
    const existing = await thread.messages.fetch(session.stage3MessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return;
    }
  }
  const sent = await thread.send(payload);
  session.stage3MessageId = sent.id;
}

function buildImportedRosterPreview(session) {
  const active = session.employees.filter((e) => !e.isWDV);
  const wdv = session.employees.filter((e) => e.isWDV);
  const lines = [
    `CONTROLE IMPORT EMS — ${formatDateFR(session.weekStart)} → ${formatDateFR(session.weekEnd)}`,
    '============================================================',
    '',
    `Détectés : ${session.employees.length} · Actifs : ${active.length} · WDV : ${wdv.length}`,
    '',
  ];
  for (const e of active) {
    const discord = session.memberMatches?.get?.(e.idUnique);
    const discordState = discord?.memberId ? `lié <@${discord.memberId}>` : discord?.ambiguous ? 'ambigu (pas de ping tant que non résolu)' : 'pas sur Discord / pas de ping';
    lines.push(`[${e.grade}] ${e.name} — ID ${e.idUnique}`);
    lines.push(`Info: ${(e.infoTokens || []).join(' ') || 'vide'} · Absence: ${e.absencesRaw || '—'} · Réa: ${e.reanimations || 0}`);
    lines.push(`Paye tableau: ${formatMoney(e.tablePay || 0)} · Date UP: ${e.lastUpRaw || '—'} · Discord: ${discordState}`);
    lines.push('------------------------------------------------------------');
  }
  if (wdv.length) {
    lines.push('', 'WDV / EXCLUS DU CALCUL');
    for (const e of wdv) lines.push(`- ${e.name} — ID ${e.idUnique}`);
  }
  return lines.join('\n');
}

function preanalysisRows(session) {
  const buttons = [
    new ButtonBuilder().setCustomId('pay:analyze').setLabel('Lancer les décisions').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pay:preview:ems').setLabel('Voir effectif importé').setEmoji('📋').setStyle(ButtonStyle.Primary),
  ];
  if ((session.discordResolutionQueue || []).length) {
    buttons.push(new ButtonBuilder().setCustomId('pay:resolve:discord:start').setLabel(`Résoudre pings (${session.discordResolutionQueue.length})`).setStyle(ButtonStyle.Secondary));
  }

  return [
    new ActionRowBuilder().addComponents(...buttons.slice(0, 5)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pay:edit:rea').setLabel('Corriger réanimations').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('pay:edit:info').setLabel('Corriger Info').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('pay:edit:pay').setLabel('Corriger paye tableau').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('pay:cancel').setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function preanalysisPayload(session) {
  const active = session.employees.filter((e) => !e.isWDV);
  const wdv = session.employees.filter((e) => e.isWDV);
  const zeroRea = active.filter((e) => Number(e.reanimations || 0) === 0).length;
  const reaWithValue = active.filter((e) => Number(e.reanimations || 0) > 0).length;
  const linkedDiscord = active.filter((e) => session.memberMatches?.get?.(e.idUnique)?.memberId).length;
  const ambiguousDiscord = active.filter((e) => session.memberMatches?.get?.(e.idUnique)?.ambiguous).length;
  const noDiscord = Math.max(0, active.length - linkedDiscord - ambiguousDiscord);
  const blocking = session.anomalies.filter((x) => /^BLOQUANT/i.test(x));
  const nonBlocking = session.anomalies.filter((x) => !/^BLOQUANT/i.test(x));

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(blocking.length ? 0xd73a49 : 0x1f6feb)
        .setTitle('Étape 3 — Contrôle complet avant analyse')
        .setDescription(
          `Le bot a terminé les rapprochements. **Un EMS sans compte Discord détecté n'est pas une erreur** : il sera simplement affiché par son nom, sans ping.\n\n` +
          `Tu peux vérifier l'effectif complet avec **Voir effectif importé**, corriger une donnée si besoin, puis lancer les décisions.`,
        )
        .addFields(
          { name: '👥 Tableau EMS', value: `${session.employees.length} détectés\n${active.length} actifs · ${wdv.length} WDV`, inline: true },
          { name: '🚑 Réanimations', value: `${session.reanimations.length} lignes\n${reaWithValue} EMS avec réa · ${zeroRea} à 0`, inline: true },
          { name: '🔗 Discord', value: `${linkedDiscord} liés\n${noDiscord} sans compte/ping · ${ambiguousDiscord} ambigus`, inline: true },
          { name: '💵 PAYES prévues', value: `${active.filter((e) => Number(e.reanimations || 0) > 0 || ['MC','ADD','CD','D','DG'].includes(e.grade)).length} ligne(s) selon la règle Pillbox`, inline: true },
          { name: '⛔ Bloquants', value: blocking.length ? blocking.slice(0, 5).map((x) => `• ${x.replace(/^BLOQUANT\s*:\s*/i, '')}`).join('\n').slice(0, 1024) : 'Aucun', inline: false },
          { name: 'ℹ️ Informations', value: nonBlocking.length ? nonBlocking.slice(-5).map((x) => `• ${x}`).join('\n').slice(0, 1024) : 'Aucune anomalie particulière', inline: false },
        ),
    ],
    components: preanalysisRows(session),
  };
}

async function sendPreanalysis(thread, session, { replace = false } = {}) {
  const payload = preanalysisPayload(session);
  if (replace && session.stage3MessageId) {
    const existing = await thread.messages.fetch(session.stage3MessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      session.workflowMessageId = existing.id;
      return;
    }
  }
  const sent = await thread.send(payload);
  session.stage3MessageId = sent.id;
  session.workflowMessageId = sent.id;
}

function stage3ManualLinkModal() {
  const modal = new ModalBuilder().setCustomId('pay:modal:resolve-rea-manual').setTitle('Lier à un EMS');
  const employee = new TextInputBuilder()
    .setCustomId('employee')
    .setLabel('Nom RP ou ID unique de l’EMS actuel')
    .setPlaceholder('Ex : Simonee Babidi ou 247144')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(employee));
  return modal;
}

function correctionModal(customId, title, fieldLabel, placeholder = '') {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const employee = new TextInputBuilder()
    .setCustomId('employee')
    .setLabel('Nom RP ou ID unique')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const value = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(fieldLabel)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(employee),
    new ActionRowBuilder().addComponents(value),
  );
  return modal;
}

async function sendLongMessage(channel, content, allowedMentions = { parse: [] }) {
  const text = String(content || '');
  const chunks = [];
  let remaining = text;
  while (remaining.length > 1900) {
    let cut = remaining.lastIndexOf('\n', 1900);
    if (cut < 500) cut = 1900;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) await channel.send({ content: chunk, allowedMentions });
}

async function readTxtAttachments(message) {
  const texts = [];
  for (const attachment of message.attachments.values()) {
    if (!attachment.name?.toLowerCase().endsWith('.txt')) continue;
    if (attachment.size > 2_000_000) throw new Error(`Fichier trop gros : ${attachment.name}`);
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Impossible de télécharger ${attachment.name}`);
    texts.push(await response.text());
  }
  return texts;
}

function employeeByName(session, value) {
  const needle = value.trim().toLowerCase();
  const exact = session.employees.find((e) => e.name.toLowerCase() === needle || e.idUnique === value.trim());
  if (exact) return exact;
  const contains = session.employees.filter((e) => e.name.toLowerCase().includes(needle));
  return contains.length === 1 ? contains[0] : null;
}

function amountModal(customId, title, amountLabel) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const employee = new TextInputBuilder()
    .setCustomId('employee')
    .setLabel('Nom RP ou ID unique')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(amountLabel)
    .setPlaceholder('1000000')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(employee),
    new ActionRowBuilder().addComponents(amount),
  );
  return modal;
}

function gradeModal(customId, title, targetLabel) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const employee = new TextInputBuilder()
    .setCustomId('employee')
    .setLabel('Nom RP ou ID unique')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const grade = new TextInputBuilder()
    .setCustomId('grade')
    .setLabel(targetLabel)
    .setPlaceholder('INF')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(employee),
    new ActionRowBuilder().addComponents(grade),
  );
  return modal;
}

async function logAction(session, interaction, action, employee = null, details = '') {
  await sendLog(client, session, action, {
    manager: interaction.member,
    employee,
    details,
  });
}

client.once(Events.ClientReady, () => {
  console.log(`[Northflank/24-7] Pillbox Paie connecté à Discord en tant que ${client.user.tag}`);
  console.log(`[Northflank/24-7] Serveur cible : ${guildId} - commande /paye disponible.`);
  console.log('[Northflank/24-7] Le processus reste actif tant que ce service Northflank est démarré.');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.guild.id !== guildId) return;
  const session = getActiveSession();
  if (!session || message.channel.id !== session.threadId || session.finalized) return;
  if (!hasPayrollManagerRole(message.member)) return;

  const importKind = session.stage === 'import_ems' ? 'ems' : session.stage === 'import_reas' ? 'reas' : null;
  if (!importKind) return;

  try {
    if (message.content?.trim()) appendRaw(importKind, message.content.trim());
    const txts = await readTxtAttachments(message);
    for (const text of txts) appendRaw(importKind, text);

    const label = importKind === 'ems' ? 'EMS' : 'Réanimations';
    await message.react('✅').catch(() => null);
    await sendLog(client, session, `Import ${label} : données reçues`, {
      manager: message.member,
      details: `${message.content?.length || 0} caractères + ${txts.length} fichier(s) TXT`,
    });
  } catch (error) {
    session.anomalies.push(error.message);
    await message.reply(`⚠️ ${error.message}`).catch(() => null);
    await sendLog(client, session, 'Erreur import', { manager: message.member, details: error.message, error: true });
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'paye') {
      if (!managerGuard(interaction)) return;
      const action = interaction.options.getString('action') || 'demarrer';
      const current = getActiveSession();

      if (action === 'statut') {
        if (!current) return interaction.reply({ content: 'Aucune session active.', ephemeral: true });
        return interaction.reply({
          content: `Session active : **${formatDateFR(current.weekStart)} → ${formatDateFR(current.weekEnd)}** · étape **${current.stage}** · thread <#${current.threadId}>`,
          ephemeral: true,
        });
      }

      if (action === 'annuler') {
        if (!current) return interaction.reply({ content: 'Aucune session active.', ephemeral: true });
        const thread = await client.channels.fetch(current.threadId).catch(() => null);
        await sendLog(client, current, 'Session annulée', { manager: interaction.member });
        clearSession();
        if (thread?.isThread()) await thread.setArchived(true, 'Session de paie annulée').catch(() => null);
        return interaction.reply({ content: '✅ Session annulée.', ephemeral: true });
      }

      if (current) {
        return interaction.reply({ content: `❌ Une session est déjà active dans <#${current.threadId}>.`, ephemeral: true });
      }
      if (interaction.channelId !== CHANNELS.PAYROLL) {
        return interaction.reply({ content: `❌ Lance /paye dans <#${CHANNELS.PAYROLL}>.`, ephemeral: true });
      }
      return interaction.showModal(startModal());
    }

    if (interaction.isModalSubmit() && interaction.customId === 'pay:start:modal') {
      if (!managerGuard(interaction)) return;
      if (getActiveSession()) return interaction.reply({ content: '❌ Une session existe déjà.', ephemeral: true });

      const start = parseDateFR(interaction.fields.getTextInputValue('week_start'));
      const end = parseDateFR(interaction.fields.getTextInputValue('week_end'));
      if (!start || !end || end < start) {
        return interaction.reply({ content: '❌ Dates invalides. Format attendu : JJ/MM/AAAA.', ephemeral: true });
      }

      const payChannel = await client.channels.fetch(CHANNELS.PAYROLL);
      if (!payChannel?.isTextBased() || !('threads' in payChannel)) {
        return interaction.reply({ content: '❌ Le salon paie ne permet pas de créer un thread.', ephemeral: true });
      }

      const threadName = `paie-${String(start.getUTCDate()).padStart(2, '0')}-${String(start.getUTCMonth()+1).padStart(2,'0')}-${String(start.getUTCFullYear()).slice(-2)}-au-${String(end.getUTCDate()).padStart(2,'0')}-${String(end.getUTCMonth()+1).padStart(2,'0')}-${String(end.getUTCFullYear()).slice(-2)}`;
      const thread = await payChannel.threads.create({
        name: threadName.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: `Session de paie créée par ${interaction.user.tag}`,
      });

      const session = createSession({
        weekStart: start,
        weekEnd: end,
        managerId: interaction.user.id,
        managerName: interaction.member.displayName,
        threadId: thread.id,
      });
      session.weekEndLabel = formatDateFR(end);

      const recordRaw = interaction.fields.getTextInputValue('record').trim();
      if (recordRaw && /^\d+$/.test(recordRaw)) session.record = Number(recordRaw);

      await interaction.reply({ content: `✅ Session créée : <#${thread.id}>`, ephemeral: true });
      await thread.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x1f6feb)
            .setTitle('📋 Import du tableau EMS')
            .setDescription(
              `Semaine : **${formatDateFR(start)} → ${formatDateFR(end)}**\nRecord actuel : **${session.record} réanimations**\n\nEnvoie maintenant le tableau EMS dans ce thread. Tu peux utiliser plusieurs messages et/ou joindre un fichier .txt.\n\nQuand tu as terminé, clique sur le bouton ci-dessous.`,
            ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pay:finish:ems').setLabel("Terminer l'import EMS").setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('pay:cancel').setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger),
          ),
        ],
      });
      await sendLog(client, session, 'Session créée', { manager: interaction.member });
      await sendLog(client, session, 'Import EMS commencé', { manager: interaction.member });
      return;
    }

    if (interaction.isButton()) {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session) return;
      if (!sameThread(interaction, session)) {
        return interaction.reply({ content: `Utilise le thread de la session : <#${session.threadId}>`, ephemeral: true });
      }

      if (interaction.customId === 'pay:cancel') {
        await interaction.reply({ content: 'Session annulée.', ephemeral: true });
        await sendLog(client, session, 'Session annulée', { manager: interaction.member });
        const thread = await client.channels.fetch(session.threadId).catch(() => null);
        clearSession();
        if (thread?.isThread()) await thread.setArchived(true, 'Session de paie annulée').catch(() => null);
        return;
      }

      if (interaction.customId === 'pay:finish:ems') {
        if (session.stage !== 'import_ems') return interaction.reply({ content: 'Étape EMS déjà terminée.', ephemeral: true });
        const parsed = parseEMS(session.rawEMS);
        if (!parsed.employees.length) return interaction.reply({ content: '❌ Aucun employé valide détecté. Continue l’import puis réessaie.', ephemeral: true });
        session.employees = parsed.employees;
        session.anomalies.push(...parsed.anomalies);
        session.stage = 'import_reas';
        await interaction.update({ components: [] });
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x1f6feb)
              .setTitle('🚑 Import des réanimations')
              .setDescription(`**${session.employees.length} employés détectés.**\n\nEnvoie maintenant le tableau Interventions / Réanimations. Plusieurs messages et fichiers .txt sont acceptés.`),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('pay:finish:reas').setLabel("Terminer l'import Réanimations").setEmoji('✅').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('pay:cancel').setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger),
            ),
          ],
        });
        await logAction(session, interaction, 'Import EMS terminé', null, `${session.employees.length} employés · ${parsed.anomalies.length} anomalie(s)`);
        await logAction(session, interaction, 'Import réanimations commencé');
        return;
      }

      if (interaction.customId === 'pay:finish:reas') {
        if (session.stage !== 'import_reas') return interaction.reply({ content: 'Étape Réanimations déjà terminée.', ephemeral: true });
        const parsed = parseReanimations(session.rawReanimations);
        if (!parsed.results.length) return interaction.reply({ content: '❌ Aucune ligne de réanimations valide détectée.', ephemeral: true });
        session.reanimations = parsed.results;
        session.anomalies.push(...parsed.anomalies);

        const match = matchReanimationsToEmployees(session.employees, session.reanimations);
        session.anomalies.push(...match.anomalies);
        session.reaMatches = match.matches;
        session.reaResolutionQueue = match.matches.filter((x) => x.ambiguous || !x.employee);

        await interaction.update({ components: [] });
        await logAction(session, interaction, 'Import réanimations terminé', null, `${session.reanimations.length} lignes détectées`);

        if (session.reaResolutionQueue.length) {
          session.stage = 'resolve_rea';
          await sendNextReaResolution(interaction.channel, session);
        } else {
          applyReanimationMatches(session.employees, session.reaMatches);
          await startBusinessWorkflow(interaction.channel, session, interaction.guild);
        }
        return;
      }

      if (interaction.customId === 'pay:resolve:rea:manual') {
        if (session.stage !== 'resolve_rea') return interaction.reply({ content: 'Cette action n’est disponible qu’à l’étape 3.', ephemeral: true });
        return interaction.showModal(stage3ManualLinkModal());
      }

      if (interaction.customId === 'pay:resolve:rea:skipall') {
        if (session.stage !== 'resolve_rea') return interaction.reply({ content: 'Cette action n’est disponible qu’à l’étape 3.', ephemeral: true });
        for (const item of session.reaResolutionQueue || []) {
          item.employee = null;
          item.ambiguous = false;
          session.ignoredReaNames ??= [];
          session.ignoredReaNames.push(item.rea.name);
        }
        const count = session.reaResolutionQueue?.length || 0;
        session.reaResolutionQueue = [];
        await interaction.deferUpdate();
        await logAction(session, interaction, 'Étape 3 : noms restants ignorés', null, `${count} nom(s) considéré(s) comme pas/plus EMS`);
        applyReanimationMatches(session.employees, session.reaMatches);
        await startBusinessWorkflow(interaction.channel, session, interaction.guild);
        return;
      }

      if (interaction.customId === 'pay:preview:ems') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'L’aperçu est disponible à l’étape 3 avant analyse.', ephemeral: true });
        const content = buildImportedRosterPreview(session);
        const attachment = new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: 'CONTROLE_IMPORT_EMS.txt' });
        return interaction.reply({ content: '📋 Voici exactement ce que le bot a compris du tableau EMS :', files: [attachment], ephemeral: true });
      }

      if (interaction.customId === 'pay:resolve:discord:start') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'Les pings se règlent avant l’analyse.', ephemeral: true });
        if (!(session.discordResolutionQueue || []).length) return interaction.reply({ content: '✅ Aucun ping ambigu à résoudre.', ephemeral: true });
        session.stage = 'resolve_discord';
        await interaction.deferUpdate();
        await sendNextDiscordResolution(interaction.channel, session);
        return;
      }

      if (interaction.customId === 'pay:analyze') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'Analyse déjà démarrée.', ephemeral: true });
        const unknown = session.employees.filter((e) => !e.isWDV && !GRADE_ORDER.includes(e.grade));
        const duplicateIds = session.employees.filter((e, i, arr) => arr.findIndex((x) => x.idUnique === e.idUnique) !== i);
        const blocking = session.anomalies.filter((x) => /^BLOQUANT/i.test(x));
        if (unknown.length || duplicateIds.length || blocking.length) {
          return interaction.reply({
            content: `❌ Analyse bloquée : ${unknown.length} grade(s) inconnu(s), ${duplicateIds.length} ID dupliqué(s), ${blocking.length} anomalie(s) bloquante(s). Corrige l'import avant de continuer.`,
            ephemeral: true,
          });
        }
        initializeQuestions(session);
        await logAction(session, interaction, 'Analyse démarrée');
        await sendCurrentStep(interaction.channel, session, interaction);
        return;
      }

      if (interaction.customId === 'pay:edit:rea') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'Les corrections source sont disponibles avant l’analyse.', ephemeral: true });
        return interaction.showModal(correctionModal('pay:modal:editrea', 'Corriger les réanimations', 'Nouveau nombre de réanimations', '70'));
      }
      if (interaction.customId === 'pay:edit:info') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'Les corrections source sont disponibles avant l’analyse.', ephemeral: true });
        return interaction.showModal(correctionModal('pay:modal:editinfo', 'Corriger la colonne Info', 'Nouvelle valeur Info', 'S1 / Q1 / A1 / STAFF / NEW...'));
      }
      if (interaction.customId === 'pay:edit:pay') {
        if (session.stage !== 'preanalysis') return interaction.reply({ content: 'Les corrections source sont disponibles avant l’analyse.', ephemeral: true });
        return interaction.showModal(correctionModal('pay:modal:editpay', 'Corriger la paye tableau', 'Nouvelle paye du tableau', '18598313'));
      }

      if (interaction.customId === 'pay:question:yes' || interaction.customId === 'pay:question:no') {
        const q = currentQuestion(session);
        if (!q) return interaction.reply({ content: 'Aucune question active.', ephemeral: true });
        const employee = session.employees.find((e) => e.idUnique === q.employeeId);
        const answer = interaction.customId.endsWith(':yes') ? 'yes' : 'no';
        applyAnswer(session, answer);
        await logAction(session, interaction, `${q.type} : ${answer === 'yes' ? 'validé' : 'refusé'}`, employee);
        await sendCurrentStep(interaction.channel, session, interaction);
        return;
      }

      if (interaction.customId === 'pay:previous') {
        const snapshot = session.questionSnapshots.pop();
        if (!snapshot) return interaction.reply({ content: 'Aucune décision précédente à restaurer.', ephemeral: true });
        restoreSnapshot(session, snapshot);
        await logAction(session, interaction, 'Retour à la question précédente');
        await sendCurrentStep(interaction.channel, session, interaction);
        return;
      }

      if (interaction.customId === 'pay:add:ppa') return interaction.showModal(amountModal('pay:modal:ppa', 'Ajouter une PPA', 'Montant PPA'));
      if (interaction.customId === 'pay:add:bonus') return interaction.showModal(amountModal('pay:modal:bonus', 'Ajouter une prime', 'Montant de la prime'));
      if (interaction.customId === 'pay:manual:up') return interaction.showModal(gradeModal('pay:modal:up', 'Promotion manuelle', 'Grade cible supérieur'));
      if (interaction.customId === 'pay:manual:down') return interaction.showModal(gradeModal('pay:modal:down', 'Rétrogradation manuelle', 'Grade cible inférieur'));

      if (interaction.customId === 'pay:finalize') {
        if (session.stage !== 'review') return interaction.reply({ content: '❌ Des décisions sont encore en cours.', ephemeral: true });
        session.finalized = true;
        session.locked = true;
        computeTop3(session);
        refreshWarnings(session);

        const six = generateSixTxt(session);
        const payChannel = await client.channels.fetch(CHANNELS.PAYROLL);
        const warnChannel = await client.channels.fetch(CHANNELS.WARNINGS);
        const announcementChannel = await client.channels.fetch(CHANNELS.ANNOUNCEMENTS);

        await interaction.update({ components: [] });

        // 6 TXT dans le salon paie.
        for (let i = 0; i < six.length; i += 3) {
          await payChannel.send({
            content: i === 0 ? `✅ **Paie finalisée — ${formatDateFR(session.weekStart)} → ${formatDateFR(session.weekEnd)}**` : undefined,
            files: six.slice(i, i + 3).map((x) => x.attachment),
          });
        }

        // Publications automatiques.
        if (warnChannel?.isTextBased()) {
          await sendLongMessage(warnChannel, buildWarningDiscordMessage(session), {
            parse: [],
            roles: [ROLES.WARNING_1, ROLES.WARNING_2, ROLES.WARNING_3],
            users: session.employees
              .map((e) => session.memberMatches?.get?.(e.idUnique)?.memberId)
              .filter(Boolean),
          });
          await logAction(session, interaction, 'Publication avertissements');
        }
        if (announcementChannel?.isTextBased()) {
          await sendLongMessage(announcementChannel, buildAnnouncementDiscordMessage(session), { parse: ['users', 'roles'] });
          await logAction(session, interaction, 'Publication annonce');
        }

        await logAction(session, interaction, 'Semaine finalisée', null, `6 TXT générés · ${session.promotions.length} promotion(s) · ${session.dismissals.length} licenciement(s)`);
        const thread = await client.channels.fetch(session.threadId).catch(() => null);
        if (thread?.isThread()) {
          await thread.send('🔒 **Session finalisée. Aucune modification supplémentaire n’est autorisée.**').catch(() => null);
          await thread.setLocked(true, 'Session de paie finalisée').catch(() => null);
          await thread.setArchived(true, 'Session de paie finalisée').catch(() => null);
        }
        clearSession();
        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:resolve:rea') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_rea') return;
      const item = session.reaResolutionQueue?.[0];
      if (!item) return interaction.reply({ content: 'Aucune correspondance à résoudre.', ephemeral: true });
      const selected = interaction.values[0];
      if (selected === '__IGNORE__') {
        item.employee = null;
        item.ambiguous = false;
        session.ignoredReaNames ??= [];
        session.ignoredReaNames.push(item.rea.name);
      } else {
        const employee = session.employees.find((e) => e.idUnique === selected);
        if (!employee) return interaction.reply({ content: 'Employé sélectionné introuvable.', ephemeral: true });
        item.employee = employee;
        item.ambiguous = false;
      }
      session.reaResolutionQueue.shift();
      await interaction.update({ components: [] });
      await logAction(session, interaction, 'Étape 3 : correspondance réanimations', item.employee, `${item.rea.name} → ${item.employee?.name || 'pas/plus EMS'}`);
      await sendNextReaResolution(interaction.channel, session);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:resolve:discord') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_discord') return;
      const item = session.discordResolutionQueue?.[0];
      if (!item) return interaction.reply({ content: 'Aucun compte Discord à résoudre.', ephemeral: true });
      const selected = interaction.values[0];
      session.memberMatches.set(item.employeeId, {
        memberId: selected === '__NONE__' ? null : selected,
        ambiguous: false,
        status: selected === '__NONE__' ? 'missing' : 'linked',
      });
      session.discordResolutionQueue.shift();
      await interaction.update({ components: [] });
      const employee = session.employees.find((e) => e.idUnique === item.employeeId);
      await logAction(session, interaction, 'Correspondance Discord résolue', employee, selected === '__NONE__' ? 'Pas de ping' : `Discord ID ${selected}`);
      await sendNextDiscordResolution(interaction.channel, session);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:top3tie') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session) return;
      const q = currentQuestion(session);
      if (!q || q.type !== 'top3_tie') return interaction.reply({ content: 'Question Top 3 expirée.', ephemeral: true });
      const selected = interaction.values[0];
      const employee = session.employees.find((e) => e.idUnique === selected);
      applyAnswer(session, selected);
      await logAction(session, interaction, `Égalité Top 3 départagée — place ${q.rank}`, employee);
      await sendCurrentStep(interaction.channel, session, interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'pay:specialize') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session) return;
      const q = currentQuestion(session);
      if (!q || q.type !== 'specialize') return interaction.reply({ content: 'Question de spécialisation expirée.', ephemeral: true });
      const value = interaction.values[0];
      applyAnswer(session, value);
      const employee = session.employees.find((e) => e.idUnique === q.employeeId);
      await logAction(session, interaction, value === 'REFUSE' ? 'UP spécialisation refusée' : `UP spécialisation validée → ${value}`, employee);
      await sendCurrentStep(interaction.channel, session, interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'pay:modal:resolve-rea-manual') {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'resolve_rea') return interaction.reply({ content: 'L’étape 3 n’est plus active.', ephemeral: true });
      const item = session.reaResolutionQueue?.[0];
      if (!item) return interaction.reply({ content: 'Aucun ancien nom à relier.', ephemeral: true });
      const employee = employeeByName(session, interaction.fields.getTextInputValue('employee'));
      if (!employee || employee.isWDV) return interaction.reply({ content: '❌ EMS introuvable ou WDV. Utilise son nom RP actuel ou son ID unique.', ephemeral: true });
      item.employee = employee;
      item.ambiguous = false;
      session.reaResolutionQueue.shift();
      await interaction.reply({ content: `✅ **${item.rea.name}** (${item.rea.reanimations} réa) lié à **${employee.name}**.`, ephemeral: true });
      await logAction(session, interaction, 'Étape 3 : lien manuel ancien nom', employee, `${item.rea.name} → ${employee.name}`);
      await sendNextReaResolution(interaction.channel, session);
      return;
    }

    if (interaction.isModalSubmit() && ['pay:modal:editrea', 'pay:modal:editinfo', 'pay:modal:editpay'].includes(interaction.customId)) {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session || session.stage !== 'preanalysis') return interaction.reply({ content: 'Correction source indisponible à cette étape.', ephemeral: true });
      const employee = employeeByName(session, interaction.fields.getTextInputValue('employee'));
      if (!employee || employee.isWDV) return interaction.reply({ content: '❌ Employé introuvable ou WDV.', ephemeral: true });
      const value = interaction.fields.getTextInputValue('value').trim();

      if (interaction.customId === 'pay:modal:editrea') {
        if (!/^\d+$/.test(value)) return interaction.reply({ content: '❌ Nombre de réanimations invalide.', ephemeral: true });
        employee.reanimations = Number(value);
        await interaction.reply({ content: `✅ ${employee.name} : réanimations corrigées à **${employee.reanimations}**.`, ephemeral: true });
        await logAction(session, interaction, 'Correction manuelle réanimations', employee, String(employee.reanimations));
        await sendPreanalysis(interaction.channel, session, { replace: true });
      } else if (interaction.customId === 'pay:modal:editinfo') {
        employee.infoRaw = value;
        employee.infoTokens = Array.from(new Set((value.match(/\b(?:S\d*|Q[1-3]|A[1-3]|AB\d*|AL\d*|STAFF|NEW|BNVL)\b/gi) || []).map((x) => x.toUpperCase())));
        await interaction.reply({ content: `✅ ${employee.name} : Info corrigée en **${value || 'vide'}**.`, ephemeral: true });
        await logAction(session, interaction, 'Correction manuelle Info', employee, value || 'vide');
        await sendPreanalysis(interaction.channel, session, { replace: true });
      } else {
        employee.tablePay = parseMoney(value);
        if (employee.tablePay < 0) return interaction.reply({ content: '❌ Paye invalide.', ephemeral: true });
        await interaction.reply({ content: `✅ ${employee.name} : paye tableau corrigée à **${formatMoney(employee.tablePay)}**.`, ephemeral: true });
        await logAction(session, interaction, 'Correction manuelle paye tableau', employee, formatMoney(employee.tablePay));
        await sendPreanalysis(interaction.channel, session, { replace: true });
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('pay:modal:')) {
      if (!managerGuard(interaction)) return;
      const session = sessionGuard(interaction);
      if (!session) return;
      if (session.stage !== 'review') return interaction.reply({ content: 'Ces actions sont disponibles au récapitulatif final.', ephemeral: true });

      const employee = employeeByName(session, interaction.fields.getTextInputValue('employee'));
      if (!employee || employee.isWDV) return interaction.reply({ content: '❌ Employé introuvable ou WDV. Utilise le nom RP exact ou l’ID unique.', ephemeral: true });

      if (interaction.customId === 'pay:modal:ppa' || interaction.customId === 'pay:modal:bonus') {
        if (isBnvl(employee)) return interaction.reply({ content: '❌ Un BNVL ne peut recevoir ni PPA ni prime optionnelle.', ephemeral: true });
        const amount = Number(interaction.fields.getTextInputValue('amount').replace(/[^\d]/g, ''));
        if (!Number.isFinite(amount) || amount < 0) return interaction.reply({ content: '❌ Montant invalide.', ephemeral: true });

        if (interaction.customId === 'pay:modal:ppa') {
          const current = Number(session.ppa[employee.idUnique] || 0);
          if (current + amount > PPA_WEEKLY_CAP) return interaction.reply({ content: `❌ Plafond PPA : ${formatMoney(PPA_WEEKLY_CAP)} par semaine.`, ephemeral: true });
          session.ppa[employee.idUnique] = current + amount;
          await interaction.reply({ content: `✅ PPA ajoutée à ${employee.name} : ${formatMoney(amount)}`, ephemeral: true });
          await logAction(session, interaction, 'PPA ajoutée', employee, formatMoney(amount));
          await sendCurrentStep(interaction.channel, session);
        } else {
          session.optionalBonuses[employee.idUnique] = Number(session.optionalBonuses[employee.idUnique] || 0) + amount;
          await interaction.reply({ content: `✅ Prime ajoutée à ${employee.name} : ${formatMoney(amount)}`, ephemeral: true });
          await logAction(session, interaction, 'Prime optionnelle ajoutée', employee, formatMoney(amount));
          await sendCurrentStep(interaction.channel, session);
        }
        return;
      }

      const target = interaction.fields.getTextInputValue('grade').trim().toUpperCase();
      if (!GRADE_ORDER.includes(target)) return interaction.reply({ content: '❌ Grade cible invalide.', ephemeral: true });

      const from = employee.grade;
      if (interaction.customId === 'pay:modal:up') {
        if (session.promotions.some((p) => p.employeeId === employee.idUnique)) return interaction.reply({ content: '❌ Cette personne a déjà reçu une promotion pendant cette semaine. Pas de double UP.', ephemeral: true });
        if (!higherGrades(from).includes(target)) return interaction.reply({ content: `❌ ${target} n’est pas supérieur à ${from}.`, ephemeral: true });
        employee.grade = target;
        employee.lastUpRaw = session.weekEndLabel || '';
        session.promotions.push({
          employeeId: employee.idUnique,
          name: employee.name,
          from,
          to: target,
          manual: true,
          automatic: false,
          reanimations: employee.reanimations || 0,
        });
        await interaction.reply({ content: `✅ UP manuelle : ${employee.name} — ${from} → ${target}`, ephemeral: true });
        await logAction(session, interaction, 'UP manuelle', employee, `${from} → ${target}`);
        await sendCurrentStep(interaction.channel, session);
      } else {
        if (!lowerGrades(from).includes(target)) return interaction.reply({ content: `❌ ${target} n’est pas inférieur à ${from}.`, ephemeral: true });
        employee.grade = target;
        employee.lastUpRaw = session.weekEndLabel || '';
        session.demotions.push({
          employeeId: employee.idUnique,
          name: employee.name,
          from,
          to: target,
          manual: true,
          reanimations: employee.reanimations || 0,
        });
        await interaction.reply({ content: `✅ Rétrogradation : ${employee.name} — ${from} → ${target}`, ephemeral: true });
        await logAction(session, interaction, 'Rétrogradation manuelle', employee, `${from} → ${target}`);
        await sendCurrentStep(interaction.channel, session);
      }
      return;
    }
  } catch (error) {
    console.error(error);
    const session = getActiveSession();
    await sendLog(client, session, 'Erreur', {
      manager: interaction.member,
      details: error?.stack || error?.message || String(error),
      error: true,
    }).catch(() => null);

    const payload = { content: `❌ Erreur : ${error.message || error}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

try {
  await registerGuildCommands({ token, clientId, guildId });
  await client.login(token);
} catch (error) {
  console.error('Impossible de démarrer le bot :', error);
  process.exit(1);
}
