require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Events, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, StringSelectMenuBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder
} = require('discord.js');
const { db, getSettings, setSetting, audit, createRequest, scheduleRoleRemoval } = require('./store');
const { branded, brandFiles, embed, button, isApprover, safe, colors } = require('./ui');
const { commands, panelPayload, reviewPayload, reviewLabels } = require('./commands');

// Use only non-privileged intents. Member data and role changes are fetched through guild REST calls.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], partials: [Partials.Channel] });
const reviewChannels = {
  registration: 'registrationReviewChannelId', promotion: 'promotionReviewChannelId', warning: 'warningReviewChannelId'
};
const field = (id, label, style = TextInputStyle.Short, required = true, placeholder = '') => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(style === TextInputStyle.Paragraph ? 900 : 100).setPlaceholder(placeholder));
function modal(id, title, fields) {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  m.addComponents(...fields);
  return m;
}
function parseAbsenceEnd(value) {
  const match = String(value).trim().match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function actionDescription(action, attendees) {
  const roster = attendees.length
    ? attendees.map((person, index) => `**${index + 1}. ${safe(person.name)}** • Passaporte: \`${safe(person.passport)}\` • Discord: <@${person.userId}> (\`${person.userId}\`)`).join('\n')
    : '_Ainda não há presenças confirmadas._';
  return `**HORÁRIO**\n${safe(action.time)}\n\n**CONTINGENTE**\n${attendees.length}/${action.capacity} vagas\n\n**PRESENÇAS CONFIRMADAS**\n${roster}`;
}
function actionAttendanceRow(messageId, count, capacity) {
  const full = count >= capacity;
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`attendance:${messageId}`)
    .setLabel(full ? 'Contingente completo' : 'Confirmar presença')
    .setStyle(full ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setEmoji(full ? '🔒' : '✅')
    .setDisabled(full));
}
async function sendLog(guild, event, actorId, subjectId, details = '') {
  audit(guild.id, event, actorId, subjectId, details);
  const channelId = getSettings(guild.id).logChannelId || process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [branded(`Auditoria • ${event}`, `Responsável: ${actorId ? `<@${actorId}>` : 'sistema'}\nAlvo: ${subjectId ? `<@${subjectId}>` : '—'}\n${safe(details)}`, colors.muted)], allowedMentions: { parse: [] } }).catch(() => {});
}
async function submitReview(interaction, kind, data, userId = interaction.user.id) {
  const settings = getSettings(interaction.guildId);
  const id = createRequest(interaction.guildId, kind, userId, data);
  const channel = await interaction.guild.channels.fetch(settings[reviewChannels[kind]] || process.env[reviewChannels[kind].replace(/[A-Z]/g, m => `_${m.toLowerCase()}`).toUpperCase()]).catch(() => null);
  if (!channel?.isTextBased()) {
    await sendLog(interaction.guild, 'solicitação sem canal de análise', interaction.user.id, userId, `${reviewLabels[kind]} #${id}`);
    return { id, sent: false };
  }
  await channel.send(reviewPayload(id, kind, userId, data));
  await sendLog(interaction.guild, 'solicitação enviada', interaction.user.id, userId, `${reviewLabels[kind]} #${id}`);
  return { id, sent: true };
}
async function routeToChannel(interaction, settingKey, envKey, payload) {
  const settings = getSettings(interaction.guildId);
  const channelId = settings[settingKey] || process.env[envKey];
  const channel = channelId && await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { sent: false };
  await channel.send(payload);
  return { sent: true, channel };
}
async function createTicket(interaction, kind) {
  const settings = getSettings(interaction.guildId);
  const existing = db.prepare("SELECT channel_id FROM tickets WHERE owner_id=? AND guild_id=? AND status='open'").get(interaction.user.id, interaction.guildId);
  if (existing) return interaction.reply({ content: `Você já tem um ticket aberto: <#${existing.channel_id}>`, ephemeral: true });
  const categoryId = settings.ticketCategoryId || process.env.TICKET_CATEGORY_ID;
  const staffRoleId = settings.ticketStaffRoleId || process.env.TICKET_STAFF_ROLE_ID;
  if (!categoryId) return interaction.reply({ content: 'Configure primeiro a categoria de tickets em /configurar.', ephemeral: true });
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 18);
  const channel = await interaction.guild.channels.create({
    name: `${kind}-${safeName}`.slice(0, 90), type: ChannelType.GuildText, parent: categoryId || undefined,
    topic: `Ticket ${kind} | owner:${interaction.user.id}`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...(staffRoleId ? [{ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
    ]
  });
  db.prepare('INSERT INTO tickets(channel_id,guild_id,owner_id,kind,created_at) VALUES(?,?,?,?,?)').run(channel.id, interaction.guildId, interaction.user.id, kind, new Date().toISOString());
  await channel.send({ content: `<@${interaction.user.id}>${staffRoleId ? ` <@&${staffRoleId}>` : ''}`, files: brandFiles(), embeds: [branded(`Ticket • ${kind}`, 'Explique o motivo do contato com o máximo de detalhes possível. A equipe pode assumir, revogar a atribuição ou encerrar este atendimento.')], components: [
    new ActionRowBuilder().addComponents(button('ticket:claim', 'Assumir', ButtonStyle.Success, '🙋'), button('ticket:revoke', 'Revogar atribuição', ButtonStyle.Secondary, '↩️'), button('ticket:close', 'Encerrar', ButtonStyle.Danger, '🔒'))
  ], allowedMentions: { users: [interaction.user.id], roles: staffRoleId ? [staffRoleId] : [] } });
  await sendLog(interaction.guild, 'ticket aberto', interaction.user.id, interaction.user.id, `${kind} • canal ${channel.id}`);
  return interaction.reply({ content: `Seu ticket foi aberto: ${channel}`, ephemeral: true });
}

client.once(Events.ClientReady, c => console.log(`Conectado como ${c.user.tag}`));
async function processExpiredRoles() {
  const now = new Date().toISOString();
  const expired = db.prepare('SELECT * FROM timed_roles WHERE expires_at <= ?').all(now);
  for (const item of expired) {
    const guild = await client.guilds.fetch(item.guild_id).catch(() => null);
    const member = guild && await guild.members.fetch(item.user_id).catch(() => null);
    if (member?.roles.cache.has(item.role_id)) await member.roles.remove(item.role_id, `Prazo da medida ${item.kind} encerrado`).catch(error => console.error(`Falha ao remover cargo temporário: ${error.message}`));
    if (guild) await sendLog(guild, 'cargo temporário removido automaticamente', client.user.id, item.user_id, `${item.kind}; prazo encerrado em ${item.expires_at}`);
    db.prepare('DELETE FROM timed_roles WHERE id=?').run(item.id);
  }
}
client.once(Events.ClientReady, () => {
  processExpiredRoles().catch(console.error);
  setInterval(() => processExpiredRoles().catch(console.error), 60_000);
});
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  const settings = getSettings(message.guild.id);
  const quarantineId = settings.quarantineChannelId || process.env.QUARANTINE_CHANNEL_ID;
  if (quarantineId && message.channel.id === quarantineId) {
    try {
      const reason = `Mensagem enviada no canal restrito de quarentena (${message.channel.id})`;
      const files = message.attachments.map(a => a.url).slice(0, 5);
      await sendLog(message.guild, 'ban automático em quarentena', client.user.id, message.author.id, `Canal ${message.channel.id}; conteúdo não coletado; anexos: ${files.join(', ') || 'nenhum'}`);
      await message.guild.members.ban(message.author.id, { reason, deleteMessageSeconds: 3600 });
      await message.delete().catch(() => {});
    } catch (error) {
      await sendLog(message.guild, 'falha no ban de quarentena', client.user.id, message.author.id, error.message);
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const s = getSettings(interaction.guildId);
      if (interaction.commandName === 'configurar') {
        const key = interaction.options.getString('chave');
        const channel = interaction.options.getChannel('canal');
        const role = interaction.options.getRole('cargo');
        const approver = interaction.options.getRole('aprovador');
        if (key.endsWith('ChannelId') || key.endsWith('CategoryId')) {
          if (!channel) return interaction.reply({ content: 'Informe o canal ou categoria no campo correspondente.', ephemeral: true });
          setSetting(interaction.guildId, key, channel.id);
        } else if (key === 'approverRoleIds') {
          if (!approver) return interaction.reply({ content: 'Informe um cargo de aprovador.', ephemeral: true });
          setSetting(interaction.guildId, key, [...new Set([...(s.approverRoleIds || []), approver.id])]);
        } else {
          if (!role) return interaction.reply({ content: 'Informe o cargo no campo correspondente.', ephemeral: true });
          setSetting(interaction.guildId, key, role.id);
        }
        await sendLog(interaction.guild, 'configuração atualizada', interaction.user.id, null, key);
        return interaction.reply({ content: `Configuração **${key}** salva.`, ephemeral: true });
      }
      if (interaction.commandName === 'painel') {
        const type = interaction.options.getString('tipo');
        if (type !== 'absence' && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Apenas a administração pode publicar este painel.', ephemeral: true });
        const settings = getSettings(interaction.guildId);
        const panelTargets = {
          registration: settings.registrationRequestChannelId || process.env.REGISTRATION_REQUEST_CHANNEL_ID,
          promotion: settings.promotionRequestChannelId || process.env.PROMOTION_REQUEST_CHANNEL_ID,
          tickets: settings.ticketPanelChannelId || process.env.TICKET_PANEL_CHANNEL_ID,
          absence: settings.absenceRequestChannelId || process.env.ABSENCE_REQUEST_CHANNEL_ID,
          discipline: settings.warningReviewChannelId || process.env.WARNING_REVIEW_CHANNEL_ID
        };
        const configured = panelTargets[type];
        const channel = interaction.options.getChannel('canal') || (configured && await interaction.guild.channels.fetch(configured).catch(() => null)) || interaction.channel;
        await channel.send(panelPayload(type));
        await sendLog(interaction.guild, 'painel publicado', interaction.user.id, null, `${type} em ${channel.id}`);
        return interaction.reply({ content: `Painel publicado em ${channel}.`, ephemeral: true });
      }
      if (interaction.commandName === 'acao') {
        const channel = interaction.options.getChannel('canal', true);
        return interaction.showModal(modal(`action_create:${channel.id}`, 'Criar painel de ação', [
          field('nome', 'Nome da ação', TextInputStyle.Short, true, 'Ex.: Operação Alfa'),
          field('horario', 'Data e horário', TextInputStyle.Short, true, 'Ex.: 10/11 às 20h (BRT)'),
          field('contingente', 'Contingente máximo', TextInputStyle.Short, true, 'Ex.: 24')
        ]));
      }
      if (interaction.commandName === 'promocao') return interaction.showModal(modal('form:promotion', 'Solicitar promoção', [field('nome', 'Nome', TextInputStyle.Short), field('id', 'ID ou passaporte', TextInputStyle.Short), field('patente', 'Patente desejada', TextInputStyle.Short), field('justificativa', 'Justificativa', TextInputStyle.Paragraph)]));
      if (interaction.commandName === 'ausencia') {
        return interaction.showModal(modal('form:absence', 'Solicitar ausência', [field('inicio', 'Início da ausência', TextInputStyle.Short, true, 'Ex.: 10/11/2026'), field('fim', 'Fim da ausência', TextInputStyle.Short, true, 'Ex.: 15/11/2026'), field('motivo', 'Motivo', TextInputStyle.Paragraph)]));
      }
      if (interaction.commandName === 'advertir') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'Você não tem permissão para abrir este fluxo.', ephemeral: true });
        const target = interaction.options.getUser('membro');
        const level = interaction.options.getString('nivel');
        const days = interaction.options.getInteger('dias');
        const reason = interaction.options.getString('motivo');
        if (level === '1' && (!days || days < 1 || days > 3)) return interaction.reply({ content: 'Advertência 1 exige duração entre 1 e 3 dias.', ephemeral: true });
        if (level === '2' && (!days || days < 3 || days > 10)) return interaction.reply({ content: 'Advertência 2 exige duração entre 3 e 10 dias.', ephemeral: true });
        if (level === '3' && days && days !== 7) return interaction.reply({ content: 'Advertência 3 é afastamento fixo de 7 dias.', ephemeral: true });
        const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!targetMember) return interaction.reply({ content: 'Membro não encontrado neste servidor.', ephemeral: true });
        const duration = level === '3' ? 7 : days;
        const measure = level === 'exoneracao' ? 'exoneracao' : `advertencia${level}`;
        const label = level === '3' ? 'Advertência 3 • Afastamento' : level === 'exoneracao' ? 'Exoneração' : `Advertência ${level}`;
        const result = await submitReview(interaction, 'warning', { membro: `${target.tag} (${target.id})`, medida: label, nivel: measure, duracao: duration ? `${duration} dia(s)` : 'permanente', motivo: reason }, target.id);
        return interaction.reply({ content: result.sent ? `Medida enviada para aprovação (#${result.id}). Ela só será aplicada após aprovação.` : `Medida registrada (#${result.id}), mas falta configurar o canal de análise.`, ephemeral: true });
      }
      if (interaction.commandName === 'ticket') return createTicket(interaction, interaction.options.getString('categoria'));
      if (interaction.commandName === 'fechar-ticket') {
        const row = db.prepare("SELECT * FROM tickets WHERE channel_id=? AND status='open'").get(interaction.channelId);
        if (!row) return interaction.reply({ content: 'Este canal não é um ticket aberto.', ephemeral: true });
        if (interaction.user.id !== row.owner_id && !isApprover(interaction.member, s) && !(s.ticketStaffRoleId && interaction.member.roles.cache.has(s.ticketStaffRoleId))) return interaction.reply({ content: 'Somente quem abriu o ticket ou a equipe pode fechá-lo.', ephemeral: true });
        db.prepare("UPDATE tickets SET status='closed' WHERE channel_id=?").run(interaction.channelId);
        await sendLog(interaction.guild, 'ticket fechado', interaction.user.id, row.owner_id, interaction.channel.name);
        await interaction.reply({ content: 'Ticket fechado. Este canal será removido em 10 segundos.' });
        setTimeout(() => interaction.channel.delete('Ticket fechado').catch(() => {}), 10000);
        return;
      }
      if (interaction.commandName === 'logs') {
        const rows = db.prepare('SELECT * FROM audit WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(interaction.guildId, interaction.options.getInteger('quantidade') || 10);
        const body = rows.length ? rows.map(r => `\`${r.created_at.slice(0, 16).replace('T', ' ')}\` **${safe(r.event)}** • ${r.actor_id ? `<@${r.actor_id}>` : 'sistema'}${r.subject_id ? ` → <@${r.subject_id}>` : ''}\n${safe(r.details || '')}`).join('\n\n') : 'Nenhum evento registrado ainda.';
        return interaction.reply({ embeds: [branded('Eventos recentes', body, colors.muted)], ephemeral: true, allowedMentions: { parse: [] } });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'panel:registration') {
        const registrationModal = new ModalBuilder().setCustomId('form:registration').setTitle('Registro FBI');
        registrationModal.addLabelComponents(
          new LabelBuilder().setLabel('Nome completo').setTextInputComponent(new TextInputBuilder().setCustomId('nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('Digite seu nome')),
          new LabelBuilder().setLabel('ID / passaporte').setTextInputComponent(new TextInputBuilder().setCustomId('id').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder('Ex.: 16629')),
          new LabelBuilder().setLabel('Cargo pretendido').setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('cargo').setPlaceholder('Selecione uma função').addOptions(
            { label: 'Agente Especial Probatório', value: 'probatorio', description: 'Ingresso e formação inicial' },
            { label: 'Agente de Campo — Nível I', value: 'campo1', description: 'Atuação de campo, nível I' },
            { label: 'Agente de Campo — Nível II', value: 'campo2', description: 'Atuação de campo, nível II' },
            { label: 'Agente de Campo — Nível III', value: 'campo3', description: 'Atuação de campo, nível III' },
            { label: 'Agente Especial — Nível I', value: 'especial1', description: 'Função especial, nível I' }
          ))
        );
        return interaction.showModal(registrationModal);
      }
      if (id === 'panel:absence') return interaction.showModal(modal('form:absence', 'Solicitar ausência', [field('inicio', 'Início da ausência', TextInputStyle.Short, true, 'Ex.: 10/11/2026'), field('fim', 'Fim da ausência', TextInputStyle.Short, true, 'Ex.: 15/11/2026'), field('motivo', 'Motivo', TextInputStyle.Paragraph)]));
      if (id === 'panel:promotion') return interaction.showModal(modal('form:promotion', 'Solicitar promoção', [field('nome', 'Nome', TextInputStyle.Short), field('id', 'ID ou passaporte', TextInputStyle.Short), field('patente', 'Patente desejada', TextInputStyle.Short), field('justificativa', 'Justificativa', TextInputStyle.Paragraph)]));
      if (id === 'panel:discipline') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'Apenas a equipe autorizada pode abrir medidas disciplinares.', ephemeral: true });
        return interaction.reply({ content: 'Use `/advertir` e selecione o membro, nível, duração e motivo.', ephemeral: true });
      }
      if (id.startsWith('ticket:') && ['suporte', 'corregedoria', 'recurso'].includes(id.split(':')[1])) return createTicket(interaction, id.split(':')[1]);
      if (id === 'ticket:claim' || id === 'ticket:revoke' || id === 'ticket:close') {
        const row = db.prepare("SELECT * FROM tickets WHERE channel_id=? AND status='open'").get(interaction.channelId);
        if (!row) return interaction.reply({ content: 'Ticket não encontrado ou já encerrado.', ephemeral: true });
        const settings = getSettings(interaction.guildId);
        const staffRoleId = settings.ticketStaffRoleId || process.env.TICKET_STAFF_ROLE_ID;
        const staff = interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) || (staffRoleId && interaction.member.roles.cache.has(staffRoleId));
        if (!staff) return interaction.reply({ content: 'Este controle é exclusivo da equipe do ticket.', ephemeral: true });
        if (id === 'ticket:claim') {
          db.prepare('UPDATE tickets SET claimed_by=? WHERE channel_id=?').run(interaction.user.id, interaction.channelId);
          await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
          await sendLog(interaction.guild, 'ticket assumido', interaction.user.id, row.owner_id, interaction.channel.name);
          return interaction.reply({ embeds: [branded('Atendimento assumido', `Responsável: <@${interaction.user.id}>`)], allowedMentions: { users: [] } });
        }
        if (id === 'ticket:revoke') {
          db.prepare('UPDATE tickets SET claimed_by=NULL WHERE channel_id=?').run(interaction.channelId);
          await interaction.channel.permissionOverwrites.delete(interaction.user.id).catch(() => {});
          await sendLog(interaction.guild, 'atribuição de ticket revogada', interaction.user.id, row.owner_id, interaction.channel.name);
          return interaction.reply({ content: 'A atribuição do ticket foi revogada.' });
        }
        db.prepare("UPDATE tickets SET status='closed', claimed_by=NULL WHERE channel_id=?").run(interaction.channelId);
        await sendLog(interaction.guild, 'ticket encerrado pela equipe', interaction.user.id, row.owner_id, interaction.channel.name);
        await interaction.reply({ content: 'Ticket encerrado. Este canal será removido em 10 segundos.' });
        setTimeout(() => interaction.channel.delete('Ticket encerrado pela equipe').catch(() => {}), 10000);
        return;
      }
      if (id.startsWith('review:')) {
        const [, kind, requestId, decision] = id.split(':');
        const settings = getSettings(interaction.guildId);
        if (!isApprover(interaction.member, settings)) return interaction.reply({ content: 'Você não tem cargo de aprovação configurado.', ephemeral: true });
        const req = db.prepare('SELECT * FROM requests WHERE id=? AND guild_id=?').get(Number(requestId), interaction.guildId);
        if (!req || req.status !== 'pending' || req.kind !== kind) return interaction.reply({ content: 'Este pedido já foi analisado ou não existe.', ephemeral: true });
        if (kind === 'action' && decision === 'approve') return interaction.showModal(modal(`action_publish:${requestId}`, 'Publicar ação aprovada', [field('canal', 'ID do canal de divulgação', TextInputStyle.Short), field('detalhes', 'Observações (opcional)', TextInputStyle.Paragraph, false)]));
        if (kind === 'warning' && decision === 'approve') {
          const data = JSON.parse(req.data);
          const target = await interaction.guild.members.fetch(req.user_id).catch(() => null);
          if (!target) return interaction.reply({ content: 'Membro não encontrado; medida não aplicada.', ephemeral: true });
          const settings = getSettings(interaction.guildId);
          const level = data.medida;
          const roleEnv = { advertencia1: 'WARNING1_ROLE_ID', advertencia2: 'WARNING2_ROLE_ID', advertencia3: 'WARNING3_ROLE_ID' };
          const roleSetting = { advertencia1: 'warning1RoleId', advertencia2: 'warning2RoleId', advertencia3: 'warning3RoleId' };
          const roleId = level === 'exoneracao' ? (settings.exoneratedRoleId || process.env.EXONERATED_ROLE_ID)
            : level === 'advertencia3' ? (settings.warning3RoleId || process.env.WARNING3_ROLE_ID || settings.suspendedRoleId || process.env.SUSPENDED_ROLE_ID)
              : (settings[roleSetting[level]] || process.env[roleEnv[level]] || settings.warningRoleId || process.env.WARNING_ROLE_ID);
          if (!roleId) return interaction.reply({ content: `Configure o cargo necessário para ${level}.`, ephemeral: true });
          const durationDays = level === 'advertencia3' ? 7 : Number.parseInt(data.duracao, 10) || 0;
          if (level !== 'exoneracao' && durationDays < 1) return interaction.reply({ content: 'Duração da advertência inválida.', ephemeral: true });
          if (level === 'exoneracao') {
            const removable = target.roles.cache.filter(r => r.id !== interaction.guild.id && !r.managed && r.position < interaction.guild.members.me.roles.highest.position).map(r => r.id);
            if (removable.length) await target.roles.remove(removable, `Exoneração aprovada #${req.id}`);
          }
          await target.roles.add(roleId, `${level} aprovada #${req.id}`);
          if (level !== 'exoneracao') {
            const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
            scheduleRoleRemoval(interaction.guildId, req.user_id, roleId, level, expiresAt);
          }
          const displayLevel = { advertencia1: 'Advertência 1', advertencia2: 'Advertência 2', advertencia3: 'Advertência 3 • Afastamento' }[level] || 'Exoneração';
          db.prepare('UPDATE requests SET status=?, reviewed_by=? WHERE id=?').run('approved', interaction.user.id, req.id);
          await interaction.message.edit({ embeds: [branded(`${displayLevel} aplicada`, `Membro: <@${req.user_id}>\nMedida: **${displayLevel}**\nDuração: **${durationDays ? `${durationDays} dia(s)` : 'permanente'}**\n${durationDays ? `Remoção automática prevista: <t:${Math.floor(Date.now() / 1000) + durationDays * 86400}:F>` : ''}\nMotivo: ${safe(data.motivo)}`, colors.danger)], components: [] });
          await sendLog(interaction.guild, `medida aplicada: ${displayLevel}`, interaction.user.id, req.user_id, `${durationDays ? `${durationDays} dia(s)` : 'permanente'} • ${data.motivo}`);
          return interaction.reply({ content: `${displayLevel} aprovada e aplicada.`, ephemeral: true });
        }
        db.prepare('UPDATE requests SET status=?, reviewed_by=? WHERE id=?').run(decision === 'approve' ? 'approved' : 'rejected', interaction.user.id, req.id);
        if (kind === 'registration' && decision === 'approve') {
          const member = await interaction.guild.members.fetch(req.user_id).catch(() => null);
          const data = JSON.parse(req.data);
          const roleIds = [...new Set([data.baseRoleId, data.roleId].filter(Boolean))];
          if (member && roleIds.length) await member.roles.add(roleIds, `Registro aprovado #${req.id}`);
          if (member && data.displayName && data.passport && data.rolePrefix) {
            const nickname = `${data.rolePrefix} ${data.displayName} | ${data.passport}`.slice(0, 32);
            await member.setNickname(nickname, `Registro aprovado #${req.id}`);
          }
        }
        await interaction.message.edit({ embeds: [embed(`${reviewLabels[kind]} • ${decision === 'approve' ? 'Aprovado' : 'Recusado'}`, `${interaction.message.embeds[0]?.description || ''}\n\n**Decisão:** ${decision === 'approve' ? 'Aprovado' : 'Recusado'} por <@${interaction.user.id}>`, decision === 'approve' ? colors.ok : colors.danger)], components: [] });
        await sendLog(interaction.guild, `${reviewLabels[kind]} ${decision === 'approve' ? 'aprovado' : 'recusado'}`, interaction.user.id, req.user_id, `pedido #${req.id}`);
        return interaction.reply({ content: `Pedido #${req.id} ${decision === 'approve' ? 'aprovado' : 'recusado'}.`, ephemeral: true });
      }
      if (id.startsWith('attendance:')) {
        const actionMessageId = id.split(':')[1];
        const action = db.prepare('SELECT * FROM actions WHERE message_id=?').get(actionMessageId);
        if (!action || action.status !== 'published') return interaction.reply({ content: 'Esta ação não está disponível.', ephemeral: true });
        const attendees = JSON.parse(action.attendees);
        if (attendees.length >= action.capacity) {
          await interaction.update({ components: [actionAttendanceRow(actionMessageId, attendees.length, action.capacity)] });
          return;
        }
        const idx = attendees.findIndex(a => a.userId === interaction.user.id);
        if (idx >= 0) {
          await interaction.deferUpdate();
          attendees.splice(idx, 1);
        }
        else {
          return interaction.showModal(modal(`attendance_form:${actionMessageId}`, 'Confirmar presença', [
            field('name', 'Seu nome', TextInputStyle.Short, true, 'Nome e sobrenome'),
            field('passport', 'Seu ID ou passaporte', TextInputStyle.Short, true, 'Ex.: 1024')
          ]));
        }
        db.prepare('UPDATE actions SET attendees=? WHERE message_id=?').run(JSON.stringify(attendees), actionMessageId);
        await interaction.message.edit({ embeds: [branded(`📋 ${action.name}`, actionDescription(action, attendees))], components: [actionAttendanceRow(actionMessageId, attendees.length, action.capacity)] });
        await sendLog(interaction.guild, 'presença removida', interaction.user.id, interaction.user.id, action.name);
        return interaction.followUp({ content: 'Sua presença foi removida.', ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id.startsWith('action_create:')) {
        await interaction.deferReply({ ephemeral: true });
        const channelId = id.split(':')[1];
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return interaction.editReply({ content: 'O canal escolhido não está disponível.' });
        const name = interaction.fields.getTextInputValue('nome').trim();
        const time = interaction.fields.getTextInputValue('horario').trim();
        const capacity = Number.parseInt(interaction.fields.getTextInputValue('contingente').trim(), 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000) return interaction.editReply({ content: 'Informe um contingente entre 1 e 2000.' });
        const action = { name, time, capacity };
        const attendees = [];
        const msg = await channel.send({
          files: brandFiles(),
          embeds: [branded(`📋 ${name}`, actionDescription(action, attendees))]
        });
        db.prepare("INSERT INTO actions(message_id,guild_id,creator_id,name,time,capacity,attendees,status) VALUES(?,?,?,?,?,?,?,'published')")
          .run(msg.id, interaction.guildId, interaction.user.id, name, time, capacity, JSON.stringify(attendees));
        await msg.edit({ components: [actionAttendanceRow(msg.id, attendees.length, capacity)] });
        await sendLog(interaction.guild, 'painel de ação publicado', interaction.user.id, null, `${name} • ${time} • contingente ${capacity} • canal ${channel.id}`);
        return interaction.editReply({ content: `Painel **${safe(name)}** publicado em ${channel}. Qualquer pessoa poderá confirmar presença no botão.` });
      }
      if (id.startsWith('attendance_form:')) {
        await interaction.deferReply({ ephemeral: true });
        const messageId = id.split(':')[1];
        const action = db.prepare("SELECT * FROM actions WHERE message_id=? AND status='published'").get(messageId);
        if (!action) return interaction.editReply({ content: 'Esta ação não está mais disponível.' });
        const attendees = JSON.parse(action.attendees);
        if (attendees.some(a => a.userId === interaction.user.id)) return interaction.editReply({ content: 'Sua presença já foi registrada.' });
        if (attendees.length >= action.capacity) {
          const fullChannel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
          const fullMessage = fullChannel && await fullChannel.messages.fetch(messageId).catch(() => null);
          if (fullMessage) await fullMessage.edit({ components: [actionAttendanceRow(messageId, attendees.length, action.capacity)] });
          return interaction.editReply({ content: 'O contingente desta ação já foi atingido; as inscrições foram encerradas.' });
        }
        const name = interaction.fields.getTextInputValue('name').trim();
        const passport = interaction.fields.getTextInputValue('passport').trim();
        attendees.push({ userId: interaction.user.id, name, passport });
        db.prepare('UPDATE actions SET attendees=? WHERE message_id=?').run(JSON.stringify(attendees), messageId);
        const channel = await interaction.guild.channels.fetch(interaction.channelId);
        const message = await channel.messages.fetch(messageId);
        await message.edit({ embeds: [branded(`📋 ${action.name}`, actionDescription(action, attendees))], components: [actionAttendanceRow(messageId, attendees.length, action.capacity)] });
        await sendLog(interaction.guild, 'presença confirmada', interaction.user.id, interaction.user.id, `${action.name} • ${name} • passaporte ${passport}`);
        return interaction.editReply({ content: 'Presença confirmada e adicionada ao painel.' });
      }
      if (id === 'form:absence') {
        const data = { inicio: interaction.fields.getTextInputValue('inicio'), fim: interaction.fields.getTextInputValue('fim'), motivo: interaction.fields.getTextInputValue('motivo') };
        const details = `**Membro:** <@${interaction.user.id}>\n**ID Discord:** \`${interaction.user.id}\`\n**Início:** ${safe(data.inicio)}\n**Fim:** ${safe(data.fim)}\n**Motivo:** ${safe(data.motivo)}`;
        const settings = getSettings(interaction.guildId);
        const request = await routeToChannel(interaction, 'absenceRequestChannelId', 'ABSENCE_REQUEST_CHANNEL_ID', { embeds: [branded('🌴 ┃ Ausência Declarada (LOA) • Solicitação', details)], allowedMentions: { users: [] } });
        const requestChannelId = settings.absenceRequestChannelId || process.env.ABSENCE_REQUEST_CHANNEL_ID;
        const recordChannelId = settings.absenceChannelId || process.env.ABSENCE_CHANNEL_ID;
        const record = requestChannelId && requestChannelId === recordChannelId ? { sent: false }
          : await routeToChannel(interaction, 'absenceChannelId', 'ABSENCE_CHANNEL_ID', { embeds: [branded('🌴 ┃ Ausência Declarada (LOA) • Registro', details)], allowedMentions: { users: [] } });
        const loaRoleId = settings.absenceRoleId || process.env.ABSENCE_ROLE_ID || '1568855402475552840';
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        let loaApplied = false;
        if (member && loaRoleId) {
          await member.roles.add(loaRoleId, 'Solicitação de ausência (LOA)').then(() => { loaApplied = true; }).catch(error => console.error(`Falha ao aplicar cargo LOA: ${error.message}`));
          const expiresAt = parseAbsenceEnd(data.fim);
          if (expiresAt) scheduleRoleRemoval(interaction.guildId, interaction.user.id, loaRoleId, 'LOA', expiresAt.toISOString());
        }
        await sendLog(interaction.guild, 'ausência registrada', interaction.user.id, interaction.user.id, `${data.inicio} a ${data.fim}: ${data.motivo}`);
        const destinations = [request.sent && `solicitação: ${request.channel}`, record.sent && `registro: ${record.channel}`].filter(Boolean).join(' • ');
        return interaction.reply({ content: `${destinations ? `Ausência enviada sem aprovação (${destinations}).` : 'Configure os canais de solicitação e/ou registro de ausências.'}${loaApplied ? ' Cargo LOA aplicado.' : ' Não consegui aplicar o cargo LOA; confira permissões e hierarquia.'}`, ephemeral: true });
      }
      if (id === 'form:registration' || id === 'form:promotion') {
        const kind = id.split(':')[1];
        const data = Object.fromEntries(interaction.fields.fields.map(f => [f.customId, f.value]));
        if (kind === 'registration') data.cargo = interaction.fields.getStringSelectValues('cargo')[0];
        const labels = { nome: 'Nome', id: 'ID/passaporte', cargo: 'Cargo pretendido', patente: 'Patente desejada', justificativa: 'Justificativa' };
        if (kind === 'registration') {
          const roles = {
            probatorio: ['Agente Especial Probatório', 'probationaryAgentRoleId', 'PROBATIONARY_AGENT_ROLE_ID', '[AGT.P]'],
            campo1: ['Agente de Campo Nível 1', 'fieldAgent1RoleId', 'FIELD_AGENT1_ROLE_ID', '[AGT.1]'],
            campo2: ['Agente de Campo Nível 2', 'fieldAgent2RoleId', 'FIELD_AGENT2_ROLE_ID', '[AGT.2]'],
            campo3: ['Agente de Campo Nível 3', 'fieldAgent3RoleId', 'FIELD_AGENT3_ROLE_ID', '[AGT.3]'],
            especial1: ['Agente Especial Nível 1', 'specialAgent1RoleId', 'SPECIAL_AGENT1_ROLE_ID', '[AGT.E1]']
          };
          const choice = data.cargo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
          if (!roles[choice]) return interaction.reply({ content: 'Cargo inválido. Escolha probatorio, campo1, campo2, campo3 ou especial1.', ephemeral: true });
          const roleId = getSettings(interaction.guildId)[roles[choice][1]] || process.env[roles[choice][2]];
          if (!roleId) return interaction.reply({ content: `Configure o cargo ${roles[choice][0]} antes de aceitar registros.`, ephemeral: true });
          data.cargo = roles[choice][0];
          data.roleId = roleId;
          data.rolePrefix = roles[choice][3];
          data.baseRoleId = getSettings(interaction.guildId).baseFbiRoleId || process.env.BASE_FBI_ROLE_ID || '1568855376605085706';
          data.displayName = data.nome;
          data.passport = data.id;
        }
        const res = await submitReview(interaction, kind, data);
        return interaction.reply({ content: res.sent ? `Solicitação enviada para análise (#${res.id}).` : `Solicitação registrada (#${res.id}); falta configurar o canal de análise.`, ephemeral: true });
      }
      if (id.startsWith('action_publish:')) {
        const requestId = Number(id.split(':')[1]);
        const req = db.prepare("SELECT * FROM requests WHERE id=? AND kind='action' AND status='pending'").get(requestId);
        if (!req) return interaction.reply({ content: 'Solicitação indisponível.', ephemeral: true });
        const settings = getSettings(interaction.guildId);
        if (!isApprover(interaction.member, settings)) return interaction.reply({ content: 'Você não pode aprovar esta ação.', ephemeral: true });
        const data = JSON.parse(req.data);
        const channelId = interaction.fields.getTextInputValue('canal').trim();
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return interaction.reply({ content: 'ID de canal inválido ou sem acesso.', ephemeral: true });
        const msg = await channel.send({ embeds: [branded(`📋 ${data.nome}`, `**Horário:** ${safe(data.horario)}\n**Contingente:** 0/${data.contingente}\n**Presenças:**\n_Nenhuma presença confirmada._`)], components: [new ActionRowBuilder().addComponents(button(`attendance:pending`, 'Adicionar presença', ButtonStyle.Success, '✅'))] });
        await msg.edit({ components: [new ActionRowBuilder().addComponents(button(`attendance:${msg.id}`, 'Adicionar presença', ButtonStyle.Success, '✅'))] });
        db.prepare("UPDATE requests SET status='approved', reviewed_by=? WHERE id=?").run(interaction.user.id, requestId);
        db.prepare('INSERT INTO actions(message_id,guild_id,creator_id,name,time,capacity,status) VALUES(?,?,?,?,?,? ,\'published\')').run(msg.id, interaction.guildId, req.user_id, data.nome, data.horario, Number(data.contingente));
        await interaction.message.edit({ embeds: [branded('Ação aprovada e publicada', `**${safe(data.nome)}** divulgada em ${channel}.\n${safe(interaction.fields.getTextInputValue('detalhes') || '')}`, colors.ok)], components: [] });
        await sendLog(interaction.guild, 'ação aprovada e publicada', interaction.user.id, req.user_id, `${data.nome} • ${channel.id}`);
        return interaction.reply({ content: `Ação publicada em ${channel}.`, ephemeral: true });
      }
      if (id.startsWith('discipline_apply:')) {
        const requestId = Number(id.split(':')[1]);
        const req = db.prepare("SELECT * FROM requests WHERE id=? AND kind='warning' AND status='pending'").get(requestId);
        if (!req) return interaction.reply({ content: 'Solicitação indisponível.', ephemeral: true });
        const settings = getSettings(interaction.guildId);
        if (!isApprover(interaction.member, settings)) return interaction.reply({ content: 'Você não pode aprovar esta medida.', ephemeral: true });
        const type = interaction.fields.getTextInputValue('tipo').trim().toLowerCase();
        const reason = interaction.fields.getTextInputValue('motivo');
        const target = await interaction.guild.members.fetch(req.user_id).catch(() => null);
        if (!target) return interaction.reply({ content: 'Membro não encontrado; a medida não foi aplicada.', ephemeral: true });
        const warningRole = settings.warningRoleId || process.env.WARNING_ROLE_ID;
        const suspendRole = settings.suspendedRoleId || process.env.SUSPENDED_ROLE_ID;
        const exoneratedRole = settings.exoneratedRoleId || process.env.EXONERATED_ROLE_ID;
        if (['afastamento'].includes(type)) {
          if (!suspendRole) return interaction.reply({ content: 'Configure o cargo de afastamento com /configurar.', ephemeral: true });
          await target.roles.add(suspendRole, `Afastamento aprovado #${requestId}`);
        } else if (['exoneracao', 'exoneração'].includes(type)) {
          if (!exoneratedRole) return interaction.reply({ content: 'Configure o cargo de exonerado com /configurar.', ephemeral: true });
          const removable = target.roles.cache.filter(r => r.id !== interaction.guild.id && !r.managed && r.position < interaction.guild.members.me.roles.highest.position).map(r => r.id);
          if (removable.length) await target.roles.remove(removable, `Exoneração aprovada #${requestId}`);
          await target.roles.add(exoneratedRole, `Exoneração aprovada #${requestId}`);
        } else {
          if (!warningRole) return interaction.reply({ content: 'Configure o cargo de advertência com /configurar.', ephemeral: true });
          await target.roles.add(warningRole, `Advertência aprovada #${requestId}`);
        }
        db.prepare("UPDATE requests SET status='approved', reviewed_by=?, review_note=? WHERE id=?").run(interaction.user.id, `${type}: ${reason}`, requestId);
        await interaction.message.edit({ embeds: [branded(`Medida aplicada • ${type}`, `Membro: <@${target.id}>\nResponsável: <@${interaction.user.id}>\nMotivo: ${safe(reason)}`, colors.danger)], components: [] });
        await sendLog(interaction.guild, `medida aplicada: ${type}`, interaction.user.id, target.id, reason);
        return interaction.reply({ content: `Medida de ${type} aplicada a ${target.user.tag}.`, ephemeral: true });
      }
    }
  } catch (error) {
    console.error(error);
    const response = { content: 'Ocorreu um erro ao processar. Verifique as permissões do bot e a configuração do servidor.', ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) throw new Error('Configure DISCORD_TOKEN no arquivo .env.');
client.login(process.env.DISCORD_TOKEN);
