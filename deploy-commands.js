import 'dotenv/config';
import { registerGuildCommands } from './src/registerCommands.js';

await registerGuildCommands({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
});
