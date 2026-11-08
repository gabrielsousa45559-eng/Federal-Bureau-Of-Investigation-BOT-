require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { panelPayload } = require('./commands');

const targets = [
  ['registration', 'REGISTRATION_REQUEST_CHANNEL_ID', 'panel:registration'],
  ['promotion', 'PROMOTION_REQUEST_CHANNEL_ID', 'panel:promotion'],
  ['tickets', 'TICKET_PANEL_CHANNEL_ID', 'ticket:suporte'],
  ['absence', 'ABSENCE_REQUEST_CHANNEL_ID', 'panel:absence'],
  ['discipline', 'WARNING_REVIEW_CHANNEL_ID', 'panel:discipline']
];

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(process.env.DISCORD_TOKEN);
    await new Promise(resolve => client.once('clientReady', resolve));
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const [type, envKey, customId] of targets) {
      const channelId = process.env[envKey];
      if (!channelId) { console.log(`${type}: canal não configurado, ignorado.`); continue; }
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) { console.log(`${type}: canal ${channelId} indisponível.`); continue; }
      const payload = panelPayload(type);
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => new Map());
      const existing = [...messages.values()].find(message => message.author.id === client.user.id && message.components.some(row => row.components.some(component => component.customId === customId)));
      if (existing) {
        await existing.edit(payload);
        console.log(`${type}: painel atualizado em #${channel.name}.`);
      } else {
        await channel.send(payload);
        console.log(`${type}: painel publicado em #${channel.name}.`);
      }
    }
  } finally {
    client.destroy();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
