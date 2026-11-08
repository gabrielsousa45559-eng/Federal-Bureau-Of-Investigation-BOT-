const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { branded, brandFiles, button, safe } = require('./ui');

const reviewKinds = ['registration', 'promotion', 'warning'];
const reviewLabels = { registration: 'Registro', promotion: 'Promoção', warning: 'Advertência' };
const commands = [
  new SlashCommandBuilder().setName('configurar').setDescription('Configura um canal, cargo ou categoria do bot.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('chave').setDescription('Item a configurar').setRequired(true).addChoices(
      { name: 'Canal de quarentena (ban automático)', value: 'quarantineChannelId' }, { name: 'Canal de logs', value: 'logChannelId' },
      { name: 'Canal de análise de registros', value: 'registrationReviewChannelId' }, { name: 'Canal de análise de promoções', value: 'promotionReviewChannelId' },
      { name: 'Canal do painel de registro', value: 'registrationRequestChannelId' },
      { name: 'Canal para solicitar promoção', value: 'promotionRequestChannelId' },
      { name: 'Canal para solicitar ausência', value: 'absenceRequestChannelId' }, { name: 'Canal de registro de ausências', value: 'absenceChannelId' },
      { name: 'Cargo aplicado durante ausência (LOA)', value: 'absenceRoleId' },
      { name: 'Canal de análise disciplinar', value: 'warningReviewChannelId' }, { name: 'Categoria de tickets', value: 'ticketCategoryId' },
      { name: 'Canal do painel de tickets', value: 'ticketPanelChannelId' }, { name: 'Cargo da equipe de tickets', value: 'ticketStaffRoleId' },
      { name: 'Cargo base FBI', value: 'baseFbiRoleId' },
      { name: 'Cargo Agente Especial Probatório', value: 'probationaryAgentRoleId' },
      { name: 'Cargo Agente de Campo Nível 1', value: 'fieldAgent1RoleId' },
      { name: 'Cargo Agente de Campo Nível 2', value: 'fieldAgent2RoleId' },
      { name: 'Cargo Agente de Campo Nível 3', value: 'fieldAgent3RoleId' },
      { name: 'Cargo Agente Especial Nível 1', value: 'specialAgent1RoleId' },
      { name: 'Cargo aplicado para advertência', value: 'warningRoleId' },
      { name: 'Cargo Advertência 1', value: 'warning1RoleId' }, { name: 'Cargo Advertência 2', value: 'warning2RoleId' },
      { name: 'Cargo Advertência 3 / afastamento 7 dias', value: 'warning3RoleId' },
      { name: 'Cargo de afastamento', value: 'suspendedRoleId' }, { name: 'Cargo de exonerado', value: 'exoneratedRoleId' }
    )).addChannelOption(o => o.setName('canal').setDescription('Canal ou categoria').addChannelTypes(ChannelType.GuildText, ChannelType.GuildCategory))
    .addRoleOption(o => o.setName('cargo').setDescription('Cargo do servidor'))
    .addRoleOption(o => o.setName('aprovador').setDescription('Cargo de aprovador (pode repetir)')),
  new SlashCommandBuilder().setName('painel').setDescription('Publica um painel interativo.')
    .addStringOption(o => o.setName('tipo').setDescription('Painel a publicar').setRequired(true).addChoices(
      { name: 'Registro', value: 'registration' }, { name: 'Solicitar promoção', value: 'promotion' },
      { name: 'Tickets', value: 'tickets' }, { name: 'Advertência e disciplina', value: 'discipline' }, { name: 'Ausência', value: 'absence' }
    )).addChannelOption(o => o.setName('canal').setDescription('Canal de destino (opcional)').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('acao').setDescription('Abre o formulário e publica um painel de ação com presenças.')
    .addChannelOption(o => o.setName('canal').setDescription('Canal onde o painel da ação será publicado').setRequired(true).addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('promocao').setDescription('Abre o formulário para solicitar promoção.'),
  new SlashCommandBuilder().setName('ausencia').setDescription('Abre o formulário de solicitação de ausência.'),
  new SlashCommandBuilder().setName('advertir').setDescription('Solicita aplicação de advertência ou exoneração.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membro').setDescription('Membro alvo').setRequired(true))
    .addStringOption(o => o.setName('nivel').setDescription('Nível da medida').setRequired(true).addChoices(
      { name: 'Advertência 1 (1 a 3 dias)', value: '1' }, { name: 'Advertência 2 (3 a 10 dias)', value: '2' },
      { name: 'Advertência 3 (afastamento de 7 dias)', value: '3' }, { name: 'Exoneração', value: 'exoneracao' }
    ))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo da medida').setRequired(true))
    .addIntegerOption(o => o.setName('dias').setDescription('Duração em dias (nível 1: 1–3; nível 2: 3–10)').setMinValue(1).setMaxValue(10))
    ,
  new SlashCommandBuilder().setName('ticket').setDescription('Abre um ticket privado.')
    .addStringOption(o => o.setName('categoria').setDescription('Tipo de atendimento').setRequired(true).addChoices(
      { name: 'Suporte', value: 'suporte' }, { name: 'Corregedoria', value: 'corregedoria' }, { name: 'Recorrer punição', value: 'recurso' }
    )),
  new SlashCommandBuilder().setName('fechar-ticket').setDescription('Fecha o ticket atual.'),
  new SlashCommandBuilder().setName('logs').setDescription('Mostra eventos recentes de auditoria.').setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1 a 20)').setMinValue(1).setMaxValue(20))
];

function panelPayload(type) {
  if (type === 'registration') return {
    files: [...brandFiles(), { attachment: require('node:path').join(__dirname, '..', 'assets-fbi-registration-banner.png'), name: 'assets-fbi-registration-banner.png' }],
    embeds: [branded('REGISTRO FBI', 'Inicie seu cadastro na unidade. Informe seu nome e passaporte, selecione a função desejada e aguarde a análise da equipe.\n\n**Funções disponíveis**\nAgente Especial Probatório\nAgente de Campo — Níveis I, II e III\nAgente Especial — Nível I').setImage('attachment://assets-fbi-registration-banner.png')],
    components: [new ActionRowBuilder().addComponents(button('panel:registration', 'Iniciar registro', ButtonStyle.Primary, '📝'))]
  };
  if (type === 'promotion') return {
    files: brandFiles(), embeds: [branded('Solicitação de promoção', 'Envie nome, ID/passaporte e patente desejada. A solicitação será encaminhada para análise.')],
    components: [new ActionRowBuilder().addComponents(button('panel:promotion', 'Solicitar promoção', ButtonStyle.Primary, '🎖️'))]
  };
  if (type === 'tickets') return {
    files: brandFiles(), embeds: [branded('Central de atendimento', 'Escolha uma categoria para abrir seu canal privado na categoria de tickets.\n\n🟦 **Suporte** — dúvidas e ajuda\n⚖️ **Corregedoria** — denúncias e questões internas\n🔨 **Recorrer punição** — revisão de penalidade\n\nA equipe terá controles para assumir, revogar a atribuição ou encerrar o ticket.')],
    components: [new ActionRowBuilder().addComponents(
      button('ticket:suporte', 'Suporte', ButtonStyle.Primary, '🟦'), button('ticket:corregedoria', 'Corregedoria', ButtonStyle.Secondary, '⚖️'), button('ticket:recurso', 'Recorrer punição', ButtonStyle.Secondary, '🔨')
    )]
  };
  if (type === 'absence') return {
    files: brandFiles(), embeds: [branded('🌴 ┃ Ausência Declarada (LOA)', 'Use o botão abaixo para informar o período e o motivo. A solicitação será registrada sem etapa de aprovação e o cargo LOA será aplicado até a data final informada.')],
    components: [new ActionRowBuilder().addComponents(button('panel:absence', 'Solicitar ausência', ButtonStyle.Primary, '📅'))]
  };
  return {
    files: brandFiles(), embeds: [branded('Painel disciplinar', 'Advertência 1: 1 a 3 dias. Advertência 2: 3 a 10 dias. Advertência 3: afastamento por 7 dias. A medida é enviada para aprovação; após aprovada, o cargo temporário é removido automaticamente no vencimento.')],
    components: [new ActionRowBuilder().addComponents(button('panel:discipline', 'Abrir medida disciplinar', ButtonStyle.Danger, '⚖️'))]
  };
}

function reviewPayload(id, kind, userId, data) {
  const labels = { displayName: 'Nome', passport: 'ID/passaporte', rolePrefix: 'Prefixo do apelido', roleId: 'ID do cargo solicitado', baseRoleId: 'ID do cargo base' };
  const lines = Object.entries(data).filter(([k]) => !['roleId', 'baseRoleId', 'rolePrefix', 'displayName', 'passport'].includes(k))
    .map(([k, v]) => `**${safe(labels[k] || k)}:** ${safe(v)}`).join('\n');
  const embed = branded(`${reviewLabels[kind]} • Solicitação #${id}`, `Solicitante: <@${userId}>\nID Discord: \`${userId}\`\n\n${lines}`);
  const components = [new ActionRowBuilder().addComponents(button(`review:${kind}:${id}:approve`, 'Aprovar', ButtonStyle.Success, '✅'), button(`review:${kind}:${id}:reject`, 'Recusar', ButtonStyle.Danger, '✖️'))];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
function actionPayload(data, messageId) {
  return {
    embeds: [branded(`📋 ${data.nome}`, `**Horário:** ${safe(data.horario)}\n**Contingente:** 0/${data.contingente}\n**Presenças:**\n_Nenhuma presença confirmada._`)],
    components: [new ActionRowBuilder().addComponents(button(`attendance:${messageId}`, 'Adicionar presença', ButtonStyle.Success, '✅'))]
  };
}
module.exports = { commands, panelPayload, reviewPayload, reviewKinds, reviewLabels, actionPayload };
