require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes
} = require('discord.js');

const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'moderation-logs.json');
const WARN_FILE = path.join(DATA_DIR, 'warnings.json');
const MOD_LIMIT_FILE = path.join(DATA_DIR, 'daily-limits.json');
const MOD_LOG_TXT_FILE = path.join(DATA_DIR, 'moderation.log');

for (const file of [LOG_FILE, WARN_FILE, MOD_LIMIT_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
}
if (!fs.existsSync(MOD_LOG_TXT_FILE)) fs.writeFileSync(MOD_LOG_TXT_FILE, '', 'utf8');

const env = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  panelPort: Number(process.env.PANEL_PORT || 3000),
  panelUrl: process.env.PANEL_URL || `http://localhost:${process.env.PANEL_PORT || 3000}`,
  panelUsers: parseList(process.env.PANEL_LOGIN_USERS),
  panelPasswords: parseList(process.env.PANEL_LOGIN_PASSWORDS),
  panelSessionHours: Number(process.env.PANEL_SESSION_HOURS || 12),
  logChannelId: process.env.LOG_CHANNEL_ID,
  ownerRoleIds: parseIds(process.env.OWNER_ROLE_IDS),
  ownerUserIds: parseIds(process.env.OWNER_USER_IDS),
  protectedRoleIds: parseIds(process.env.PROTECTED_ROLE_IDS),
  protectedUserIds: parseIds(process.env.PROTECTED_USER_IDS),
  adminRoleIds: parseIds(process.env.ADMIN_ROLE_IDS),
  modRoleIds: parseIds(process.env.MOD_ROLE_IDS),
  jrModRoleIds: parseIds(process.env.JR_MOD_ROLE_IDS),
  bannedWords: parseWords(process.env.BANNED_WORDS),
  mentionOwnerAllowed: toBool(process.env.ALLOW_OWNER_PINGS, false),
  mentionOwnerRolesAllowed: toBool(process.env.ALLOW_OWNER_ROLE_PINGS, false),
  mentionProtectedAllowed: toBool(process.env.ALLOW_PROTECTED_PINGS, false),
  mentionProtectedRolesAllowed: toBool(process.env.ALLOW_PROTECTED_ROLE_PINGS, false),
  spamMessageCount: Number(process.env.SPAM_MESSAGE_COUNT || 6),
  spamWindowSec: Number(process.env.SPAM_WINDOW_SEC || 8),
  duplicateCount: Number(process.env.DUPLICATE_COUNT || 5),
  duplicateWindowSec: Number(process.env.DUPLICATE_WINDOW_SEC || 60),
  capsRatio: Number(process.env.CAPS_RATIO || 0.75),
  capsMinLength: Number(process.env.CAPS_MIN_LENGTH || 8),
  warnBanLimit: Number(process.env.WARN_BAN_LIMIT || 15),
  autoBanDays: Number(process.env.AUTO_BAN_DAYS || 7),
  timeouts: {
    bad_word: parseDurations(process.env.TIMEOUT_BAD_WORD),
    spam: parseDurations(process.env.TIMEOUT_SPAM),
    duplicate: parseDurations(process.env.TIMEOUT_DUPLICATE),
    mention: parseDurations(process.env.TIMEOUT_MENTION),
    manual: parseDurations(process.env.TIMEOUT_MANUAL)
  }
};

if (!env.token || !env.clientId || !env.guildId || !env.logChannelId) {
  console.error('Hiányzó kötelező .env változók: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const userMessageCache = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('moderacio')
    .setDescription('Moderációs műveletek')
    .addSubcommand(sc =>
      sc.setName('ban')
        .setDescription('Felhasználó kitiltása')
        .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
        .addStringOption(o => o.setName('indok').setDescription('Indok').setRequired(false)))
    .addSubcommand(sc =>
      sc.setName('kick')
        .setDescription('Felhasználó kirúgása')
        .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
        .addStringOption(o => o.setName('indok').setDescription('Indok').setRequired(false)))
    .addSubcommand(sc =>
      sc.setName('timeout')
        .setDescription('Némítás (timeout)')
        .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
        .addIntegerOption(o => o.setName('perc').setDescription('Perc').setRequired(true).setMinValue(1).setMaxValue(40320))
        .addStringOption(o => o.setName('indok').setDescription('Indok').setRequired(false)))
    .addSubcommand(sc =>
      sc.setName('untimeout')
        .setDescription('Némítás feloldása')
        .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
        .addStringOption(o => o.setName('indok').setDescription('Indok').setRequired(false))),

  new SlashCommandBuilder()
    .setName('figy')
    .setDescription('Figyelmeztetés adása')
    .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
    .addStringOption(o => o.setName('indok').setDescription('Indok').setRequired(true)),

  new SlashCommandBuilder()
    .setName('figylista')
    .setDescription('Felhasználó figyelmeztetései')
    .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true)),

  new SlashCommandBuilder()
    .setName('figytorles')
    .setDescription('Figyelmeztetés törlése')
    .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
    .addStringOption(o => o.setName('figyelmeztetes_id').setDescription('Figyelmeztetés ID').setRequired(true)),

  new SlashCommandBuilder().setName('jogok').setDescription('Saját jogok megtekintése'),
  new SlashCommandBuilder().setName('limit').setDescription('Napi moderációs limitek ellenőrzése'),

  new SlashCommandBuilder()
    .setName('rankadas')
    .setDescription('Rank hozzáadása')
    .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
    .addRoleOption(o => o.setName('rang').setDescription('Rang').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ranktorles')
    .setDescription('Rank eltávolítása')
    .addUserOption(o => o.setName('felhasznalo').setDescription('Cél').setRequired(true))
    .addRoleOption(o => o.setName('rang').setDescription('Rang').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Üzenetek törlése')
    .addIntegerOption(o => o.setName('mennyiseg').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName('panel').setDescription('Web panel megnyitása')
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Bejelentkezve: ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const level = await getUserLevel(interaction.member);
    if (!canUseCommand(interaction.commandName, level)) {
      return interaction.reply({ embeds: [embed('Nincs jogosultság', 'Ehhez a parancshoz nincs jogod.', 0xff3b30)], ephemeral: true });
    }

    if (interaction.commandName === 'jogok') return handleJogok(interaction, level);
    if (interaction.commandName === 'limit') return handleLimit(interaction, level);
    if (interaction.commandName === 'panel') return handlePanel(interaction);
    if (interaction.commandName === 'figy') return handleFigy(interaction, 'manual');
    if (interaction.commandName === 'figylista') return handleFigyLista(interaction);
    if (interaction.commandName === 'figytorles') return handleFigyTorles(interaction);
    if (interaction.commandName === 'rankadas') return handleRank(interaction, true);
    if (interaction.commandName === 'ranktorles') return handleRank(interaction, false);
    if (interaction.commandName === 'clear') return handleClear(interaction);
    if (interaction.commandName === 'moderacio') return handleModeracio(interaction, level);
  } catch (error) {
    console.error(error);
    const content = { embeds: [embed('Hiba', 'Váratlan hiba történt.', 0xff3b30)], ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.followUp(content);
    return interaction.reply(content);
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content;
  updateUserMessageCache(message);

  if (isCapsViolation(content)) {
    await message.delete().catch(() => null);
    await message.channel.send({ embeds: [embed('Caps lock tiltás', `${message.author} kérlek ne írj végig nagybetűvel.`)] })
      .then(m => setTimeout(() => m.delete().catch(() => null), 7000));
    return;
  }

  const badWord = findBannedWord(content);
  if (badWord) return processViolation(message, 'bad_word', `Tiltott szó: ${badWord}`, badWord);

  if (hasMentionViolation(message)) return processViolation(message, 'mention', 'Védett személy/rang pingelése', null);

  if (isSpam(message.author.id)) return processViolation(message, 'spam', 'Túl sok üzenet rövid idő alatt', null);

  if (isDuplicateSpam(message.author.id)) return processViolation(message, 'duplicate', 'Ugyanaz az üzenet 5x 1 percen belül', null);
});

function parseIds(value = '') {
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

function parseWords(value = '') {
  return value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

function parseDurations(value = '') {
  const arr = value.split(',').map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v >= 0);
  return arr.length ? arr : [600, 1800, 3600];
}

function parseList(value = '') {
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'igen'].includes(String(value).toLowerCase());
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function embed(title, description, color = 0x3b82f6) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(env.token);
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
}

async function getUserLevel(member) {
  if (!member) return 'NONE';
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return 'ADMIN';
  const roles = member.roles.cache;
  if (roles.some(r => env.adminRoleIds.includes(r.id))) return 'ADMIN';
  if (roles.some(r => env.modRoleIds.includes(r.id))) return 'MOD';
  if (roles.some(r => env.jrModRoleIds.includes(r.id))) return 'JR_MOD';
  return 'NONE';
}

function canUseCommand(commandName, level) {
  const full = ['moderacio', 'figy', 'figylista', 'figytorles', 'jogok', 'limit', 'rankadas', 'ranktorles', 'clear', 'panel'];
  if (level === 'ADMIN' || level === 'MOD') return full.includes(commandName);
  if (level === 'JR_MOD') return ['figy', 'figylista', 'jogok', 'limit', 'clear', 'panel'].includes(commandName);
  return commandName === 'jogok';
}

function getCommandListByLevel(level) {
  if (level === 'ADMIN' || level === 'MOD') return '/moderacio /figy /figylista /figytorles /jogok /limit /rankadas /ranktorles /clear /panel';
  if (level === 'JR_MOD') return '/figy /figylista /jogok /limit /clear /panel';
  return '/jogok';
}

async function handleJogok(interaction, level) {
  const roleNames = interaction.member.roles.cache.map(r => r.name).filter(name => name !== '@everyone').join(', ') || 'Nincs';
  await interaction.reply({
    embeds: [embed('Jogosultságok', `**Szinted:** ${level}\n**Rangjaid:** ${roleNames}\n**Használható parancsok:** ${getCommandListByLevel(level)}`)],
    ephemeral: true
  });
}

async function handleLimit(interaction, level) {
  const limits = readJson(MOD_LIMIT_FILE);
  const today = getTodayKey();
  const entry = limits.find(i => i.userId === interaction.user.id && i.date === today) || { bans: 0, kicks: 0 };
  const text = level === 'JR_MOD'
    ? `JR Mod limit: Ban ${entry.bans}/1, Kick ${entry.kicks}/2`
    : level === 'MOD'
      ? `Mod limit: Ban ${entry.bans}/3, Kick ${entry.kicks}/5`
      : 'Admin limit: végtelen';
  await interaction.reply({ embeds: [embed('Napi limit', text)], ephemeral: true });
}

async function handlePanel(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Panel megnyitása').setStyle(ButtonStyle.Link).setURL(env.panelUrl)
  );
  await interaction.reply({ embeds: [embed('Web panel', 'A gombra kattintva megnyithatod a kezelőfelületet.')], components: [row], ephemeral: true });
}

async function handleFigy(interaction, reasonType) {
  const user = interaction.options.getUser('felhasznalo');
  const reason = interaction.options.getString('indok');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const result = await createWarning({
    guild: interaction.guild,
    member,
    user,
    moderator: interaction.user,
    reason,
    rule: reasonType,
    channel: interaction.channel,
    messageContent: null,
    forbiddenWord: null,
    doTimeout: true
  });
  await interaction.reply({ embeds: [embed('Figyelmeztetés rögzítve', `ID: **${result.warningId}**\nÖsszes figyelmeztetés: **${result.warningCount}**`)] });
}

async function handleFigyLista(interaction) {
  const user = interaction.options.getUser('felhasznalo');
  const warnings = readJson(WARN_FILE).filter(w => w.userId === user.id);
  const desc = warnings.length
    ? warnings.slice(-20).map(w => `• [${w.id}] | ${w.rule} | ${w.reason} | ${new Date(w.timestamp).toLocaleString('hu-HU')}`).join('\n')
    : 'Nincs figyelmeztetés.';
  await interaction.reply({ embeds: [embed(`Figyelmeztetések - ${user.tag}`, desc)], ephemeral: true });
}

async function handleFigyTorles(interaction) {
  const user = interaction.options.getUser('felhasznalo');
  const warningId = interaction.options.getString('figyelmeztetes_id');
  const warnings = readJson(WARN_FILE);
  const idx = warnings.findIndex(w => w.id === warningId && w.userId === user.id);
  if (idx === -1) return interaction.reply({ embeds: [embed('Nem található', 'Nincs ilyen figyelmeztetés.', 0xff3b30)], ephemeral: true });
  warnings.splice(idx, 1);
  writeJson(WARN_FILE, warnings);
  await interaction.reply({ embeds: [embed('Törölve', `Figyelmeztetés törölve: ${warningId}`)] });
}

async function handleRank(interaction, add) {
  const user = interaction.options.getUser('felhasznalo');
  const role = interaction.options.getRole('rang');
  const member = await interaction.guild.members.fetch(user.id);
  if (add) await member.roles.add(role);
  else await member.roles.remove(role);
  await interaction.reply({ embeds: [embed('Rang frissítve', `${role} ${add ? 'hozzáadva' : 'eltávolítva'}: ${user}`)] });
}

async function handleClear(interaction) {
  const amount = interaction.options.getInteger('mennyiseg');
  const deleted = await interaction.channel.bulkDelete(amount, true);
  await interaction.reply({ embeds: [embed('Törlés kész', `${deleted.size} üzenet törölve.`)], ephemeral: true });
}

async function handleModeracio(interaction, level) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser('felhasznalo');
  const reason = interaction.options.getString('indok') || 'Nincs megadva';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (['ban', 'kick'].includes(sub) && !checkAndConsumeLimit(interaction.user.id, level, sub)) {
    return interaction.reply({ embeds: [embed('Napi limit elérve', `A mai ${sub} limitet elérted.`, 0xff3b30)], ephemeral: true });
  }

  if (sub === 'ban') await interaction.guild.members.ban(user.id, { reason });
  if (sub === 'kick') await member?.kick(reason);
  if (sub === 'timeout') {
    const mins = interaction.options.getInteger('perc');
    await member?.timeout(mins * 60 * 1000, reason);
  }
  if (sub === 'untimeout') await member?.timeout(null, reason);

  await appendLog({
    type: `manual_${sub}`,
    userId: user.id,
    username: user.tag,
    channelId: interaction.channel.id,
    channelName: interaction.channel.name,
    message: null,
    forbiddenWord: null,
    reason,
    warningId: null,
    timeoutDurationSec: sub === 'timeout' ? interaction.options.getInteger('perc') * 60 : 0,
    warningCount: countWarnings(user.id),
    moderator: interaction.user.tag,
    timestamp: new Date().toISOString()
  });

  await interaction.reply({ embeds: [embed('Moderáció kész', `${sub.toUpperCase()} végrehajtva: ${user}`)] });
}

function checkAndConsumeLimit(userId, level, action) {
  if (level === 'ADMIN') return true;
  const configs = {
    JR_MOD: { ban: 1, kick: 2 },
    MOD: { ban: 3, kick: 5 }
  };
  const max = configs[level]?.[action];
  if (max == null) return false;

  const limits = readJson(MOD_LIMIT_FILE);
  const today = getTodayKey();
  let entry = limits.find(i => i.userId === userId && i.date === today);
  if (!entry) {
    entry = { userId, date: today, bans: 0, kicks: 0 };
    limits.push(entry);
  }
  const key = action === 'ban' ? 'bans' : 'kicks';
  if (entry[key] >= max) return false;
  entry[key] += 1;
  writeJson(MOD_LIMIT_FILE, limits);
  return true;
}

function isCapsViolation(content) {
  const letters = content.replace(/[^a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, '');
  if (letters.length < env.capsMinLength) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÖŐÚÜŰ]/g, '').length;
  return upper / letters.length >= env.capsRatio;
}

function findBannedWord(content) {
  const lower = content.toLowerCase();
  return env.bannedWords.find(word => word && lower.includes(word)) || null;
}

function updateUserMessageCache(message) {
  const now = Date.now();
  const userId = message.author.id;
  const entry = userMessageCache.get(userId) || [];
  entry.push({ at: now, content: message.content, channelId: message.channel.id });
  userMessageCache.set(userId, entry.filter(m => now - m.at <= Math.max(env.spamWindowSec, env.duplicateWindowSec) * 1000));
}

function isSpam(userId) {
  const now = Date.now();
  const entry = userMessageCache.get(userId) || [];
  return entry.filter(m => now - m.at <= env.spamWindowSec * 1000).length >= env.spamMessageCount;
}

function isDuplicateSpam(userId) {
  const now = Date.now();
  const entry = userMessageCache.get(userId) || [];
  const recent = entry.filter(m => now - m.at <= env.duplicateWindowSec * 1000);
  const grouped = recent.reduce((acc, msg) => {
    const key = msg.content.trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.values(grouped).some(count => count >= env.duplicateCount);
}

function hasMentionViolation(message) {
  const mentionedUsers = [...message.mentions.users.keys()];
  const mentionedRoles = [...message.mentions.roles.keys()];

  if (!env.mentionOwnerAllowed && mentionedUsers.some(id => env.ownerUserIds.includes(id))) return true;
  if (!env.mentionProtectedAllowed && mentionedUsers.some(id => env.protectedUserIds.includes(id))) return true;
  if (!env.mentionOwnerRolesAllowed && mentionedRoles.some(id => env.ownerRoleIds.includes(id))) return true;
  if (!env.mentionProtectedRolesAllowed && mentionedRoles.some(id => env.protectedRoleIds.includes(id))) return true;

  return false;
}

function countWarnings(userId) {
  return readJson(WARN_FILE).filter(w => w.userId === userId).length;
}

function timeoutByWarn(rule, warningCount) {
  const base = env.timeouts[rule] || env.timeouts.manual;
  const idx = Math.min(Math.ceil(warningCount / 3) - 1, base.length - 1);
  return base[Math.max(idx, 0)] || 0;
}

async function processViolation(message, rule, reason, badWord) {
  await message.delete().catch(() => null);
  const result = await createWarning({
    guild: message.guild,
    member: message.member,
    user: message.author,
    moderator: client.user,
    reason,
    rule,
    channel: message.channel,
    messageContent: message.content,
    forbiddenWord: badWord,
    doTimeout: true
  });

  await message.channel.send({
    embeds: [embed('Automoderáció', `${message.author} szabálysértés miatt kezelve. Figyelmeztetés: **${result.warningCount}/${env.warnBanLimit}**`)]
  }).then(m => setTimeout(() => m.delete().catch(() => null), 10000));
}

async function createWarning({ guild, member, user, moderator, reason, rule, channel, messageContent, forbiddenWord, doTimeout }) {
  const warnings = readJson(WARN_FILE);
  const warningCount = warnings.filter(w => w.userId === user.id).length + 1;
  const warningId = `W-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const timeoutSec = doTimeout ? timeoutByWarn(rule, warningCount) : 0;

  const warning = {
    id: warningId,
    userId: user.id,
    username: user.tag,
    reason,
    rule,
    timestamp: new Date().toISOString(),
    moderator: moderator.tag || 'SYSTEM'
  };
  warnings.push(warning);
  writeJson(WARN_FILE, warnings);

  if (member && timeoutSec > 0) {
    await member.timeout(timeoutSec * 1000, `${rule}: ${reason}`).catch(() => null);
  }

  if (warningCount >= env.warnBanLimit) {
    const banMs = env.autoBanDays * 24 * 60 * 60 * 1000;
    await guild.members.ban(user.id, { reason: `Automata ban ${warningCount} figyelmeztetés miatt` }).catch(() => null);
    await appendLog({
      type: 'auto_ban',
      userId: user.id,
      username: user.tag,
      channelId: channel.id,
      channelName: channel.name,
      message: messageContent,
      forbiddenWord,
      reason: `Warn limit elérve (${warningCount})`,
      warningId,
      timeoutDurationSec: Math.floor(banMs / 1000),
      warningCount,
      moderator: 'SYSTEM',
      timestamp: new Date().toISOString()
    });
  }

  await appendLog({
    type: rule,
    userId: user.id,
    username: user.tag,
    channelId: channel.id,
    channelName: channel.name,
    message: messageContent,
    forbiddenWord,
    reason,
    warningId,
    timeoutDurationSec: timeoutSec,
    warningCount,
    moderator: moderator.tag || 'SYSTEM',
    timestamp: new Date().toISOString()
  });

  return { warningId, warningCount, timeoutSec };
}

async function appendLog(logEntry) {
  const logs = readJson(LOG_FILE);
  logs.push(logEntry);
  writeJson(LOG_FILE, logs.slice(-5000));
  fs.appendFileSync(MOD_LOG_TXT_FILE, JSON.stringify(logEntry) + '\n', 'utf8');

  const channel = await client.channels.fetch(env.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const description = [
    `**Szabálysértés:** ${logEntry.type}`,
    `**Felhasználó:** ${logEntry.username} (${logEntry.userId})`,
    `**Csatorna:** ${logEntry.channelName} (${logEntry.channelId})`,
    `**Üzenet:** ${logEntry.message || 'N/A'}`,
    `**Tiltószó:** ${logEntry.forbiddenWord || 'N/A'}`,
    `**Indok:** ${logEntry.reason}`,
    `**Figyelmeztetés ID:** ${logEntry.warningId || 'N/A'}`,
    `**Némítás idő:** ${logEntry.timeoutDurationSec || 0} mp`,
    `**Figyelmeztetések száma:** ${logEntry.warningCount || 0}`,
    `**Moderátor:** ${logEntry.moderator}`,
    `**Időpont:** ${new Date(logEntry.timestamp).toLocaleString('hu-HU')}`
  ].join('\n');

  await channel.send({ embeds: [embed('Moderációs log', description)] }).catch(() => null);
}

function startPanel() {
  const app = express();
  const panelSessions = new Map();
  const panelCredentials = buildPanelCredentials();

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/public', express.static(path.join(__dirname, 'public')));

  app.get('/login', (req, res) => {
    if (isPanelAuthenticated(req, panelSessions)) return res.redirect('/');
    const errorText = req.query.error ? '<p class="error-msg">Hibás felhasználónév vagy jelszó.</p>' : '';
    res.send(`<!doctype html><html lang="hu"><head><meta charset="UTF-8"/><title>Panel Login</title>
      <link rel="stylesheet" href="/public/style.css" /></head><body>
      <div class="container"><h1>Crystal Panel Belépés</h1>
      <p>Jelentkezz be a webes moderációs felülethez.</p>${errorText}
      <form method="post" action="/login" class="login-form">
        <input name="username" placeholder="Felhasználónév" required />
        <input type="password" name="password" placeholder="Jelszó" required />
        <button type="submit">Belépés</button>
      </form>
      </div></body></html>`);
  });

  app.post('/login', (req, res) => {
    const { username = '', password = '' } = req.body;
    if (!validatePanelCredential(panelCredentials, username, password)) {
      return res.redirect('/login?error=1');
    }

    const sessionToken = crypto.randomBytes(24).toString('hex');
    const maxAgeMs = env.panelSessionHours * 60 * 60 * 1000;
    panelSessions.set(sessionToken, { username, expiresAt: Date.now() + maxAgeMs });
    res.setHeader('Set-Cookie', `panel_session=${sessionToken}; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Strict; Path=/`);
    return res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    const token = getCookie(req, 'panel_session');
    if (token) panelSessions.delete(token);
    res.setHeader('Set-Cookie', 'panel_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/');
    return res.redirect('/login');
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/public') || req.path === '/login') return next();
    if (!isPanelAuthenticated(req, panelSessions)) return res.redirect('/login');
    next();
  });

  app.get('/', (req, res) => {
    const logs = readJson(LOG_FILE).slice(-300).reverse();
    const rows = logs.map(l => `<tr>
      <td>${escapeHtml(l.type)}</td><td>${escapeHtml(l.username)}</td><td>${escapeHtml(l.channelName || '')}</td>
      <td>${escapeHtml(l.message || '')}</td><td>${escapeHtml(l.forbiddenWord || '')}</td><td>${escapeHtml(l.reason || '')}</td>
      <td>${escapeHtml(l.warningId || '')}</td><td>${l.timeoutDurationSec || 0}</td><td>${l.warningCount || 0}</td><td>${new Date(l.timestamp).toLocaleString('hu-HU')}</td>
    </tr>`).join('');

    const activeSession = getPanelSession(req, panelSessions);

    res.send(`<!doctype html><html lang="hu"><head><meta charset="UTF-8"/><title>Crystal Mod Panel</title>
      <link rel="stylesheet" href="/public/style.css" /></head><body>
      <div class="container"><h1>Crystal Moderációs Panel</h1>
      <p>Bejelentkezve mint: <strong>${escapeHtml(activeSession?.username || 'ismeretlen')}</strong></p>
      <form method="post" action="/logout"><button type="submit">Kijelentkezés</button></form>
      <p>Gyors moderáció:</p>
      <form method="post" action="/action">
        <input name="guildId" placeholder="Guild ID" value="${env.guildId}" required />
        <input name="userId" placeholder="Felhasználó ID" required />
        <select name="action"><option value="warn">Warn</option><option value="kick">Kick</option><option value="ban">Ban</option></select>
        <input name="reason" placeholder="Indok" value="Panel moderáció" />
        <button type="submit">Végrehajtás</button>
      </form>
      <h2>Moderációs logok</h2>
      <table><thead><tr><th>Típus</th><th>Felhasználó</th><th>Csatorna</th><th>Üzenet</th><th>Tiltószó</th><th>Indok</th><th>Figy ID</th><th>Némítás mp</th><th>Figyszám</th><th>Időpont</th></tr></thead>
      <tbody>${rows}</tbody></table></div></body></html>`);
  });

  app.post('/action', async (req, res) => {
    const { guildId, userId, action, reason = 'Panel moderáció' } = req.body;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return res.status(404).send('Guild nem található');
    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member?.user || await client.users.fetch(userId).catch(() => null);
    if (!user) return res.status(404).send('Felhasználó nem található');

    if (action === 'warn') {
      await createWarning({ guild, member, user, moderator: client.user, reason, rule: 'manual', channel: guild.systemChannel || guild.channels.cache.find(c => c.isTextBased()), messageContent: null, forbiddenWord: null, doTimeout: true });
    }
    if (action === 'kick') await member?.kick(reason);
    if (action === 'ban') await guild.members.ban(user.id, { reason });

    res.redirect('/');
  });

  app.listen(env.panelPort, () => {
    console.log(`Panel fut: ${env.panelUrl}`);
  });
}

function buildPanelCredentials() {
  const entries = [];
  for (let i = 0; i < Math.min(env.panelUsers.length, env.panelPasswords.length); i += 1) {
    entries.push({ username: env.panelUsers[i], password: env.panelPasswords[i] });
  }
  if (!entries.length) {
    console.warn('Nincs panel felhasználó beállítva. Állítsd be: PANEL_LOGIN_USERS és PANEL_LOGIN_PASSWORDS');
  }
  return entries;
}

function validatePanelCredential(credentials, username, password) {
  return credentials.some(c => c.username === username && c.password === password);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map(v => v.trim());
  const key = `${name}=`;
  const found = parts.find(p => p.startsWith(key));
  return found ? found.slice(key.length) : null;
}

function getPanelSession(req, sessions) {
  const token = getCookie(req, 'panel_session');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function isPanelAuthenticated(req, sessions) {
  return Boolean(getPanelSession(req, sessions));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

startPanel();
client.login(env.token);
