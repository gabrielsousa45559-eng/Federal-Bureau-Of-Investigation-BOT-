const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const colors = { brand: 0x173b82, ok: 0x2eaa73, warn: 0xe3a51a, danger: 0xc83d4b, muted: 0x5865f2 };
function embed(title, description, color = colors.brand) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}
function branded(title, description, color = colors.brand) {
  const card = embed(title, description, color).setFooter({ text: process.env.BRAND_NAME || 'Federal Bureau of Investigation • FBI' });
  if (fs.existsSync(path.join(__dirname, '..', 'assets-fbi-seal.png'))) card.setThumbnail('attachment://assets-fbi-seal.png');
  return card;
}
function brandFiles() {
  const image = path.join(__dirname, '..', 'assets-fbi-seal.png');
  return fs.existsSync(image) ? [{ attachment: image, name: 'assets-fbi-seal.png' }] : [];
}
function button(customId, label, style = ButtonStyle.Primary, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}
function isApprover(member, settings) {
  const roles = (settings.approverRoleIds || []).filter(Boolean);
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild') || roles.some(id => member.roles.cache.has(id));
}
function safe(text) { return String(text).replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere').slice(0, 1000); }
module.exports = { colors, embed, branded, brandFiles, button, isApprover, safe };
