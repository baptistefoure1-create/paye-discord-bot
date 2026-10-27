import { REST, Routes } from 'discord.js';
import { payeCommand } from './commands/paye.js';

export async function registerGuildCommands({ token, clientId, guildId }) {
  if (!token || !clientId || !guildId) {
    throw new Error('DISCORD_TOKEN, CLIENT_ID et GUILD_ID sont requis.');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: [payeCommand.toJSON()] },
  );

  console.log('Commande /paye vérifiée/déployée automatiquement sur le serveur de test.');
}
