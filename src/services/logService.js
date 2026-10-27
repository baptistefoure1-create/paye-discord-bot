import { EmbedBuilder } from 'discord.js';
import { CHANNELS } from '../config/channels.js';
import { formatDateFR } from '../utils/dates.js';

export async function sendLog(client, session, action, options = {}) {
  const channel = await client.channels.fetch(CHANNELS.LOGS).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(options.error ? 0xd73a49 : 0x1f6feb)
    .setTitle(options.error ? 'Erreur bot paie' : 'Log bot paie')
    .addFields(
      { name: 'Gestionnaire', value: options.manager ? `<@${options.manager.id}> (${options.manager.user?.username || options.manager.displayName})` : session?.managerId ? `<@${session.managerId}>` : '—', inline: false },
      { name: 'Semaine', value: session ? `${formatDateFR(session.weekStart)} → ${formatDateFR(session.weekEnd)}` : '—', inline: true },
      { name: 'Action', value: action, inline: false },
    )
    .setTimestamp();

  if (options.employee) embed.addFields({ name: 'Employé', value: `${options.employee.name} (${options.employee.idUnique})`, inline: true });
  if (options.details) embed.addFields({ name: 'Détails', value: String(options.details).slice(0, 1000), inline: false });

  await channel.send({ embeds: [embed] }).catch(() => null);
}
