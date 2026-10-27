import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { buildNearQuotaQuestions, applyAutomaticQuotaTransitions, refreshWarnings, computeTop3, buildTop3TieQuestions } from './payrollRules.js';
import { snapshotForBack } from './sessionService.js';
import { setQLevel, removeSAndQ } from './warningService.js';

export function initializeQuestions(session) {
  session.questions = buildNearQuotaQuestions(session);
  session.currentQuestionIndex = 0;
  session.stage = 'near_quota';
  if (!session.questions.length) advanceStage(session);
}

export function advanceStage(session) {
  if (session.stage === 'near_quota') {
    session.questions = [];
    session.currentQuestionIndex = 0;
    applyAutomaticQuotaTransitions(session);
    session.stage = 'decisions';
  }

  if (session.stage === 'decisions' && session.currentQuestionIndex >= session.questions.length) {
    refreshWarnings(session);
    const ties = buildTop3TieQuestions(session);
    if (ties.length) {
      session.questions = ties;
      session.currentQuestionIndex = 0;
      session.stage = 'top3_ties';
    } else {
      computeTop3(session);
      session.stage = 'review';
    }
  }
}

export function currentQuestion(session) {
  return session.questions[session.currentQuestionIndex] || null;
}

export function questionComponents(question) {
  const back = new ButtonBuilder()
    .setCustomId('pay:previous')
    .setLabel('Précédent')
    .setEmoji('⬅️')
    .setStyle(ButtonStyle.Secondary);

  if (question.type === 'top3_tie') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('pay:top3tie')
      .setPlaceholder(`Choisir la place n°${question.rank}`)
      .addOptions(question.candidates.map((candidate) => ({
        label: candidate.name.slice(0, 100),
        description: `${candidate.reanimations} réanimations · ID ${candidate.idUnique}`.slice(0, 100),
        value: candidate.idUnique,
      })));
    return [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(back),
    ];
  }

  if (question.type === 'specialize') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('pay:specialize')
      .setPlaceholder('Choisir la spécialisation')
      .addOptions(
        { label: 'Médecin Formateur', value: 'MF' },
        { label: 'Médecin Psychologue', value: 'MP' },
        { label: 'Refuser la promotion', value: 'REFUSE' },
      );
    return [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(back),
    ];
  }

  const yes = new ButtonBuilder()
    .setCustomId('pay:question:yes')
    .setLabel(question.type === 'promote' ? 'Valider' : 'Oui')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);
  const no = new ButtonBuilder()
    .setCustomId('pay:question:no')
    .setLabel(question.type === 'promote' ? 'Refuser' : 'Non')
    .setEmoji('❌')
    .setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(yes, no, back)];
}

export function questionEmbed(question, index, total) {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle(`${question.title}`)
    .setDescription(question.prompt)
    .setFooter({ text: `Question ${index + 1}/${total}` });
}

export function applyAnswer(session, answer) {
  const question = currentQuestion(session);
  if (!question) return;
  session.questionSnapshots.push(snapshotForBack(session));
  const employee = session.employees.find((e) => e.idUnique === question.employeeId);

  if (question.type === 'near_quota') {
    session.quotaOverrides[question.employeeId] = answer === 'yes';
  } else if (question.type === 'q_confirm') {
    if (answer === 'yes') setQLevel(employee, question.nextQ);
  } else if (question.type === 'dismiss') {
    if (answer === 'yes') {
      employee.dismissed = true;
      session.dismissals.push({
        employeeId: employee.idUnique,
        name: employee.name,
        grade: employee.grade,
        reason: question.reason,
      });
    }
  } else if (question.type === 'promote') {
    if (answer === 'yes') {
      const from = employee.grade;
      employee.grade = question.targetGrade;
      employee.lastUpRaw = session.weekEndLabel || '';
      removeSAndQ(employee);
      session.promotions.push({
        employeeId: employee.idUnique,
        name: employee.name,
        from,
        to: question.targetGrade,
        manual: false,
        automatic: false,
        reanimations: employee.reanimations || 0,
      });
    }
  } else if (question.type === 'specialize') {
    if (answer === 'MF' || answer === 'MP') {
      const from = employee.grade;
      employee.grade = answer;
      employee.lastUpRaw = session.weekEndLabel || '';
      removeSAndQ(employee);
      session.promotions.push({
        employeeId: employee.idUnique,
        name: employee.name,
        from,
        to: answer,
        manual: false,
        automatic: false,
        reanimations: employee.reanimations || 0,
      });
    }
  } else if (question.type === 'top3_tie') {
    session.top3Selections ??= {};
    session.top3Selections[question.rank] = answer;
    for (let i = session.currentQuestionIndex + 1; i < session.questions.length; i++) {
      const next = session.questions[i];
      if (next.type === 'top3_tie' && next.tieValue === question.tieValue) {
        next.candidates = next.candidates.filter((candidate) => candidate.idUnique !== answer);
      }
    }
  }

  session.currentQuestionIndex += 1;
  if (session.stage === 'near_quota' && session.currentQuestionIndex >= session.questions.length) {
    advanceStage(session);
  } else if (session.stage === 'decisions' && session.currentQuestionIndex >= session.questions.length) {
    advanceStage(session);
  } else if (session.stage === 'top3_ties' && session.currentQuestionIndex >= session.questions.length) {
    computeTop3(session);
    session.stage = 'review';
  }
}
