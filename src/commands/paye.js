import { SlashCommandBuilder } from 'discord.js';

export const payeCommand = new SlashCommandBuilder()
  .setName('paye')
  .setDescription('Lancer ou gérer une session hebdomadaire de paie EMS')
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('Action à effectuer')
      .setRequired(false)
      .addChoices(
        { name: 'Démarrer une nouvelle session', value: 'demarrer' },
        { name: 'Voir le statut', value: 'statut' },
        { name: 'Annuler la session', value: 'annuler' },
      ),
  );
