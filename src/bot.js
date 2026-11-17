import {
  AttachmentBuilder, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits,
  RESTJSONErrorCodes, SlashCommandBuilder,
} from 'discord.js';
import { addDays, dateLabel, monthWeeks, today, validDate, validateEvent } from './calendar.js';
import { openCalendar } from './store.js';
import { button, dayView, eventModal, filename, manageView, message, monthView, rangeView, row, text, weekView } from './views.js';
import { renderCalendarImage } from './images.js';

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) throw new Error('請在部署平台的 Secret 設定 DISCORD_TOKEN。');

const guildId = process.env.DISCORD_GUILD_ID;
const channelId = process.env.DISCORD_CHANNEL_ID;
if (!guildId || !channelId) throw new Error('請設定 DISCORD_GUILD_ID 和 DISCORD_CHANNEL_ID。');
const store = openCalendar(process.env.CALENDAR_DB || './data/calendar.sqlite');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const command = new SlashCommandBuilder().setName('行事曆').setDescription('查看這個頻道的月曆與日程');
const boardKey = `board:${guildId}:${channelId}`;
const drafts = new Map();
let registered = false;
let boardDay;
let boardDirty = true;
let refreshTask;

function renderMessage({ image, ...payload }) {
  if (!image) return payload;
  return { ...payload, files: [new AttachmentBuilder(renderCalendarImage(image), { name: filename })] };
}

function logError(action, error) {
  console.error(action, error.code ?? error.name, error.message);
}

function isBoard(candidate) {
  return candidate?.author?.id === client.user.id && candidate.components.some(component =>
    component.components?.some(child => child.customId?.startsWith('wcal:range:')),
  );
}

async function findBoard(channel) {
  const id = store.setting(boardKey);
  if (id) {
    const candidate = await channel.messages.fetch({ message: id, force: true }).catch(error => {
      if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
      return null;
    });
    if (isBoard(candidate)) return candidate;
  }
  const pins = await channel.messages.fetchPins();
  const pinned = pins.items.map(item => item.message).find(isBoard);
  if (pinned) return pinned;
  return (await channel.messages.fetch({ limit: 25 })).find(isBoard);
}

async function publishBoard(currentDay) {
  const channel = await client.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildText || channel.guildId !== guildId) {
    throw new Error('指定頻道必須是指定伺服器中的文字頻道。');
  }
  const me = channel.guild.members.me ?? await channel.guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  const needed = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'PinMessages'];
  const missing = needed.filter(permission => !permissions?.has(PermissionFlagsBits[permission]));
  if (missing.length) throw new Error(`#行事曆需要 BOT 權限 ${missing.join(', ')}`);
  if (!registered) {
    await channel.guild.commands.create(command);
    registered = true;
  }
  const existing = await findBoard(channel);
  const payload = renderMessage(monthView(store, currentDay.slice(0, 7)));
  const board = existing ? await existing.edit(payload) : await channel.send(payload);
  store.setSetting(boardKey, board.id);
  if (!board.pinned) await board.pin('置頂 Cinnamoroll Calendar');
}

function refreshBoard() {
  if (refreshTask || !client.isReady()) return;
  refreshTask = (async () => {
    while (boardDirty || boardDay !== today()) {
      const currentDay = today();
      boardDirty = false;
      await publishBoard(currentDay);
      boardDay = currentDay;
    }
  })().catch(error => {
    boardDirty = true;
    logError('更新置頂月曆失敗', error);
  }).finally(() => { refreshTask = undefined; });
}

function markBoardDirty() {
  boardDirty = true;
  refreshBoard();
}

function viewer(interaction) {
  return { id: interaction.user.id, canManage: interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) };
}

function canEdit(event, user) {
  return event?.status === 'active' && (event.owner === user.id || user.canManage);
}

function replyPrivate(interaction, payload) {
  return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
}

function notify(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
}

async function show(interaction, build) {
  if (interaction.isButton() && interaction.message.flags.has(MessageFlags.Ephemeral)) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.editReply(renderMessage(build()));
  } catch (error) {
    logError('產生月曆畫面失敗', error);
    await interaction.editReply(message([text('暫時無法顯示行事曆，請再試一次。')]));
  }
}

async function save(interaction, action, value, revision) {
  const editing = action === 'save-edit';
  const eventId = Number(value);
  const previous = editing ? store.get(eventId) : null;
  const user = viewer(interaction);
  if (editing && (!canEdit(previous, user) || previous.revision !== Number(revision))) {
    return notify(interaction, '這筆日程已變更或無法編輯，請回到單日安排重新開啟。');
  }
  if (!editing && !validDate(value)) return notify(interaction, '找不到這個日期。');

  const input = {
    date: editing ? interaction.fields.getTextInputValue('date') : value,
    ...Object.fromEntries(['title', 'time', 'location', 'notes'].map(key => [key, interaction.fields.getTextInputValue(key)])),
  };
  const result = validateEvent(input);
  if (result.error) {
    drafts.set(interaction.id, {
      owner: user.id, expires: Date.now() + 600_000, input, previous,
    });
    return replyPrivate(interaction, message([
      text(result.error),
      row(button(`retry:${interaction.id}`, '修改剛才的內容')),
    ]));
  }

  const saved = editing ? store.update(result.event, eventId, Number(revision)) : store.create(result.event, user.id, interaction.id);
  if (!saved) return notify(interaction, '這筆日程剛被變更，請回到單日安排重新開啟。');
  if ([saved.date, previous?.date].some(date => date?.startsWith(today().slice(0, 7)))) markBoardDirty();
  return show(interaction, () => {
    const day = store.list(saved.date, addDays(saved.date, 1));
    const page = Math.floor(day.findIndex(event => event.id === saved.id) / 4);
    return dayView(store, saved.date, user, page, `已${editing ? '更新' : '新增'}至 ${dateLabel(saved.date)}。`);
  });
}

async function handle(interaction) {
  const slash = interaction.isChatInputCommand() && interaction.commandName === command.name;
  const component = (interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('wcal:');
  if (!slash && !component) return;
  if (interaction.guildId !== guildId || interaction.channelId !== channelId) {
    return notify(interaction, `請到 <#${channelId}> 使用行事曆。`);
  }
  if (slash) return show(interaction, () => monthView(store, today().slice(0, 7)));

  const [, action, value, argument] = interaction.customId.split(':');
  if (interaction.isModalSubmit()) {
    if (action === 'save-new' || action === 'save-edit') return save(interaction, action, value, argument);
    return;
  }

  const user = viewer(interaction);
  const currentDay = today();
  const month = value === 'current' ? currentDay.slice(0, 7) : value;
  const date = value === 'today' ? currentDay : value;
  const isMonth = validDate(`${month}-01`);

  switch (action) {
    case 'month':
      if (isMonth) return show(interaction, () => monthView(store, month));
      break;
    case 'range':
      if (isMonth && /^[0-2]$/.test(argument)) return show(interaction, () => rangeView(month, Number(argument)));
      break;
    case 'week':
      if (isMonth && (argument === 'default' || (/^[0-5]$/.test(argument) && monthWeeks(month)[Number(argument)]))) {
        return show(interaction, () => weekView(store, month, argument));
      }
      break;
    case 'day':
      if (validDate(date)) return show(interaction, () => dayView(store, date, user, Number(argument) || 0));
      break;
    case 'add':
      if (validDate(date)) return interaction.showModal(eventModal(date));
      break;
    case 'manage':
    case 'edit':
    case 'confirm':
    case 'cancel': {
      const event = store.get(Number(value));
      if (!canEdit(event, user)) return notify(interaction, '這筆日程已取消，或你沒有編輯權限。');
      if (action === 'edit') return interaction.showModal(eventModal(event.date, event));
      if (action !== 'cancel') return show(interaction, () => manageView(event, action === 'confirm'));
      if (!store.cancel(event.id, Number(argument))) {
        return notify(interaction, '這筆日程剛被變更，請重新確認。');
      }
      if (event.date.startsWith(currentDay.slice(0, 7))) markBoardDirty();
      return show(interaction, () => dayView(store, event.date, user, 0, '已取消日程。'));
    }
    case 'retry': {
      const draft = drafts.get(value);
      if (!draft || draft.expires <= Date.now() || draft.owner !== user.id) {
        return notify(interaction, '暫存內容已過期，請重新開啟表單。');
      }
      if (draft.previous && store.get(draft.previous.id)?.revision !== draft.previous.revision) {
        return notify(interaction, '這筆日程已變更，請重新開啟編輯表單。');
      }
      return interaction.showModal(eventModal(draft.input.date, draft.previous, draft.input));
    }
  }
  return notify(interaction, '這個按鈕已更新，請從置頂月曆重新開啟。');
}

client.once(Events.ClientReady, ready => {
  console.log(`Cinnamoroll Calendar 已連線為 ${ready.user.tag}，目標頻道 ${channelId}`);
  refreshBoard();
});
client.on(Events.MessageDelete, deleted => {
  if (deleted.channelId === channelId && deleted.id === store.setting(boardKey)) markBoardDirty();
});
client.on(Events.Error, error => logError('Discord 連線發生錯誤', error));
client.on(Events.InteractionCreate, interaction => {
  void handle(interaction).catch(error => {
    logError('處理 Discord 互動失敗', error);
    return notify(interaction, '暫時無法完成操作，請再試一次。').catch(() => {});
  });
});
const timer = setInterval(() => {
  for (const [id, draft] of drafts) {
    if (draft.expires < Date.now()) drafts.delete(id);
  }
  refreshBoard();
}, 60_000);
timer.unref();

await client.login(token);
