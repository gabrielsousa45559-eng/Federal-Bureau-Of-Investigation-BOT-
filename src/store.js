const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
const db = new Database(path.join(__dirname, '..', 'data', 'bot.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (guild_id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tickets (channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS actions (message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, creator_id TEXT NOT NULL, name TEXT NOT NULL, time TEXT NOT NULL, capacity INTEGER NOT NULL, attendees TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending');
  CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_by TEXT, review_note TEXT);
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT, subject_id TEXT, event TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS timed_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(guild_id,user_id,kind));
`);
const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
if (!ticketColumns.includes('claimed_by')) db.exec('ALTER TABLE tickets ADD COLUMN claimed_by TEXT');

const getSettingsStmt = db.prepare('SELECT json FROM settings WHERE guild_id = ?');
function getSettings(guildId) {
  const row = getSettingsStmt.get(guildId);
  return row ? JSON.parse(row.json) : {};
}
function setSetting(guildId, key, value) {
  const settings = getSettings(guildId);
  settings[key] = value;
  db.prepare('INSERT INTO settings(guild_id,json) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET json=excluded.json')
    .run(guildId, JSON.stringify(settings));
  return settings;
}
function audit(guildId, event, actorId = null, subjectId = null, details = '') {
  db.prepare('INSERT INTO audit(guild_id,actor_id,subject_id,event,details,created_at) VALUES(?,?,?,?,?,?)')
    .run(guildId, actorId, subjectId, event, details, new Date().toISOString());
}
function createRequest(guildId, kind, userId, data) {
  return db.prepare('INSERT INTO requests(guild_id,kind,user_id,data,created_at) VALUES(?,?,?,?,?)')
    .run(guildId, kind, userId, JSON.stringify(data), new Date().toISOString()).lastInsertRowid;
}
function scheduleRoleRemoval(guildId, userId, roleId, kind, expiresAt) {
  db.prepare(`INSERT INTO timed_roles(guild_id,user_id,role_id,kind,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id,kind) DO UPDATE SET role_id=excluded.role_id,expires_at=excluded.expires_at`)
    .run(guildId, userId, roleId, kind, expiresAt);
}

module.exports = { db, getSettings, setSetting, audit, createRequest, scheduleRoleRemoval };
