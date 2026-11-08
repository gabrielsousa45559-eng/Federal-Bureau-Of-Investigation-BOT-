require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('Configure DISCORD_TOKEN e CLIENT_ID no .env.');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const body = commands.map(c => c.toJSON());
(async () => {
  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
    console.log(`Registrados ${body.length} comandos no servidor ${process.env.GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
    console.log(`Registrados ${body.length} comandos globais (propagação pode levar algum tempo).`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
