import { escapeMarkdown } from '@discordjs/formatters';
import { Buffer } from 'node:buffer';
import { addDays, dateLabel, monthWeeks, shiftMonth, timeLabel, today, validDate, validateEvent } from './calendar.js';
import { calendarHTML } from './cloud-image.js';
import art from './.cloud-art.js';
import { button, dayView, eventModal, filename, manageView, message, monthView, rangeView, row, text, weekView } from './views.js';

const ephemeral = 64;
const utf8 = new TextEncoder();

async function authentic(request, body, publicKey) {
  const time = request.headers.get('x-signature-timestamp');
  const signature = request.headers.get('x-signature-ed25519');
  if (!/^\d{10}$/.test(time ?? '') || Math.abs(Date.now() / 1000 - Number(time)) > 300 ||
    !/^[0-9a-f]{128}$/i.test(signature ?? '')) return false;
  const key = await crypto.subtle.importKey('raw', Buffer.from(publicKey, 'hex'), 'Ed25519', false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, Buffer.from(signature, 'hex'), utf8.encode(time + body));
}

const callback = (type, data) => Response.json({ type, ...(data ? { data } : {}) });
const privateReply = (content) => callback(4, { content, flags: ephemeral, allowed_mentions: { parse: [] } });
const isPrivateButton = (interaction) => interaction.type === 3 && Boolean(interaction.message.flags & ephemeral);
const values = (interaction) => Object.fromEntries(interaction.data.components.flatMap(part => {
  const fields = part.components ?? [part.component].filter(Boolean);
  return fields.map(field => [field.custom_id, field.value ?? '']);
}));

function toDiscord(payload) {
  return {
    components: payload.components.map(component => component.toJSON()),
    flags: payload.flags, allowed_mentions: payload.allowedMentions, attachments: [],
  };
}

function showInline(interaction, view) {
  const payload = toDiscord(view);
  if (isPrivateButton(interaction)) return callback(7, payload);
  return callback(4, { ...payload, flags: payload.flags | ephemeral });
}

function sql(env, query, ...params) {
  return env.DB.prepare(query).bind(...params);
}

async function snapshot(env, from, until) {
  const { results } = await sql(env, `
    SELECT * FROM events WHERE date >= ? AND date < ?
    ORDER BY date, (status = 'cancelled'), start, id
  `, from, until).all();
  return { list: (start, end) => results.filter(event => event.date >= start && event.date < end) };
}

function monthSnapshot(env, month) {
  return snapshot(env, `${month}-01`, `${shiftMonth(month, 1)}-01`);
}

async function screenshot(env, data) {
  const html = calendarHTML(data, art);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', utf8.encode(html))).toString('hex');
  const cached = await sql(env, 'SELECT png FROM image_cache WHERE hash = ? AND expires > ?', hash, Date.now()).first('png');
  if (cached) return new Uint8Array(cached).buffer;
  try {
    const response = await env.BROWSER.quickAction('screenshot', {
      html, selector: '#calendar',
      viewport: { width: data.kind === 'month' ? 1120 : 820, height: 800, deviceScaleFactor: 1 },
      screenshotOptions: { type: 'png' },
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      console.warn('Calendar image could not be rendered', response.status);
      return null;
    }
    const png = await response.arrayBuffer();
    if (png.byteLength < 1_500_000) await sql(env, `
      INSERT OR REPLACE INTO image_cache(hash, png, expires) VALUES (?, ?, ?)
    `, hash, png, Date.now() + 86_400_000).run();
    return png;
  } catch {
    console.warn('Browser Run is temporarily unavailable');
    return null;
  }
}

function textFallback(payload, image) {
  payload.components.splice(1, 1);
  if (image.kind !== 'month') return;
  const active = image.events.filter(event => event.status === 'active');
  if (!active.length) return;
  const lines = active.slice(0, 12).map(event =>
    `${dateLabel(event.date)} · ${timeLabel(event)}　${escapeMarkdown(event.title)}`,
  );
  if (active.length > 12) lines.push('所有日期可在「本月明細」查看。');
  payload.components.splice(1, 0, text(lines.join('\n')).toJSON());
}

function multipart(payload, png) {
  const form = new FormData();
  payload.attachments = [{ id: 0, filename }];
  form.set('payload_json', JSON.stringify(payload));
  form.set('files[0]', new Blob([png], { type: 'image/png' }), filename);
  return form;
}

async function discord(env, method, path, data, webhook = false, allowMissing = false) {
  const headers = webhook ? {} : { Authorization: `Bot ${env.DISCORD_TOKEN}` };
  const json = data && !(data instanceof FormData);
  if (json) headers['Content-Type'] = 'application/json';
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method, headers, body: json ? JSON.stringify(data) : data,
  });
  if (!response.ok) {
    if (allowMissing && response.status === 404) return null;
    const error = await response.json().catch(() => ({}));
    throw new Error(`Discord API ${method} ${response.status} (${error.code ?? 'unknown'})`);
  }
  return response.status === 204 ? null : response.json();
}

async function showLater(env, interaction, work) {
  const reply = `/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  try {
    const view = await work();
    const payload = toDiscord(view);
    const png = view.image && await screenshot(env, view.image);
    if (view.image && !png) textFallback(payload, view.image);
    await discord(env, 'PATCH', reply, png ? multipart(payload, png) : payload, true);
  } catch (error) {
    console.error('Calendar interaction failed', error.message);
    await discord(env, 'PATCH', reply, toDiscord(message([text('暫時無法完成，請重試。')])), true).catch(() => {});
  }
}

function defer(env, ctx, interaction, work, refresh = false) {
  // Acknowledge first so Discord can create the original response before the PATCH.
  ctx.waitUntil(new Promise(resolve => setTimeout(resolve, 250))
    .then(() => showLater(env, interaction, work))
    .then(async () => {
      if (!refresh) return;
      await new Promise(resolve => setTimeout(resolve, 11_000));
      await refreshBoard(env);
    }).catch(error => console.error('Calendar update failed', error.message)));
  return isPrivateButton(interaction) ? callback(6) : callback(5, { flags: ephemeral });
}

async function register(env) {
  const board = await sql(env, 'SELECT branded, registered FROM board WHERE id = 1').first();
  if (!board.branded) {
    const app = await discord(env, 'GET', '/applications/@me');
    if (app.id !== env.DISCORD_APPLICATION_ID) throw new Error('Wrong Discord application token');
    await discord(env, 'PATCH', '/applications/@me', { icon: art.app });
    await discord(env, 'PATCH', '/users/@me', { avatar: art.app });
    await sql(env, 'UPDATE board SET branded = 1 WHERE id = 1').run();
  }
  if (!board.registered) {
    await discord(env, 'POST', `/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`, {
      name: '行事曆', description: '查看 Cinnamoroll Calendar 月曆與日程', type: 1,
    });
    await sql(env, 'UPDATE board SET registered = 1 WHERE id = 1').run();
  }
}

async function refreshBoard(env) {
  if (!env.DISCORD_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_CHANNEL_ID) return;
  const currentDay = today();
  const lock = Date.now() + 30_000;
  const board = await sql(env, `
    UPDATE board SET unlock_at = ? WHERE id = 1 AND unlock_at <= ?
      AND (rendered_day IS NULL OR rendered_day <> ? OR published_revision <> revision)
    RETURNING message_id, revision
  `, lock, Date.now(), currentDay).first();
  if (!board) return;
  try {
    await register(env);
    const channel = `/channels/${env.DISCORD_CHANNEL_ID}`;
    const info = await discord(env, 'GET', channel);
    if (info.guild_id !== env.DISCORD_GUILD_ID || info.type !== 0) throw new Error('Unexpected calendar channel');
    const month = currentDay.slice(0, 7);
    const view = monthView(await monthSnapshot(env, month), month);
    const png = await screenshot(env, view.image);
    if (!png && board.message_id) return;
    const payload = toDiscord(view);
    if (!png) textFallback(payload, view.image);
    const options = () => png ? multipart(toDiscord(view), png) : payload;
    let existingId = board.message_id;
    if (!existingId) {
      const recent = await discord(env, 'GET', `${channel}/messages?limit=25`);
      existingId = recent.find(entry => entry.author.id === env.DISCORD_APPLICATION_ID &&
        entry.components?.some(part => part.components?.some(child => child.custom_id?.startsWith('wcal:range:'))))?.id;
    }
    let published = existingId && await discord(env, 'PATCH', `${channel}/messages/${existingId}`, options(), false, true);
    if (!published) published = await discord(env, 'POST', `${channel}/messages`, options());
    await sql(env, 'UPDATE board SET message_id = ? WHERE id = 1 AND unlock_at = ?', published.id, lock).run();
    if (!published.pinned) await discord(env, 'PUT', `${channel}/messages/pins/${published.id}`);
    await sql(env, 'UPDATE board SET published_revision = ?, rendered_day = ? WHERE id = 1 AND unlock_at = ?',
      png ? board.revision : 0, currentDay, lock).run();
  } catch (error) {
    console.error('Calendar board refresh failed', error.message);
  } finally {
    await sql(env, 'UPDATE board SET unlock_at = 0 WHERE id = 1 AND unlock_at = ?', lock).run();
  }
}

function viewer(interaction) {
  return {
    id: interaction.member.user.id,
    canManage: Boolean(BigInt(interaction.member.permissions ?? '0') & (8192n | 8n)),
  };
}

const getEvent = (env, id) => sql(env, 'SELECT * FROM events WHERE id = ?', Number(id)).first();
const canEdit = (event, user) => event?.status === 'active' && (event.owner === user.id || user.canManage);

async function save(env, ctx, interaction, action, value, revision, user) {
  const editing = action === 'save-edit';
  const previous = editing ? await getEvent(env, value) : null;
  if (editing && (!canEdit(previous, user) || previous.revision !== Number(revision))) {
    return privateReply('這筆日程已變更或無法編輯，請回到單日安排重新開啟。');
  }
  if (!editing && !validDate(value)) return privateReply('找不到這個日期。');
  const fields = values(interaction);
  const input = {
    date: editing ? fields.date : value,
    title: fields.title ?? '', time: fields.time ?? '', location: fields.location ?? '', notes: fields.notes ?? '',
  };
  const result = validateEvent(input);
  if (result.error) {
    await sql(env, 'INSERT OR REPLACE INTO drafts(id, owner, payload, expires) VALUES (?, ?, ?, ?)',
      interaction.id, user.id, JSON.stringify({ input, previous }), Date.now() + 600_000).run();
    return showInline(interaction, message([text(result.error), row(button(`retry:${interaction.id}`, '修改剛才的內容'))]));
  }
  return defer(env, ctx, interaction, async () => {
    const event = result.event;
    const fields = [event.date, event.title, event.start, event.end, event.location, event.notes];
    let saved;
    if (editing) {
      saved = await sql(env, `
        UPDATE events SET date = ?, title = ?, start = ?, end = ?, location = ?, notes = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'active' RETURNING *
      `, ...fields, previous.id, previous.revision).first();
    } else {
      saved = await sql(env, `INSERT INTO events(date, title, start, end, location, notes, owner, created_interaction)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(created_interaction) DO NOTHING RETURNING *
      `, ...fields, user.id, interaction.id).first();
      saved ??= await sql(env, 'SELECT * FROM events WHERE created_interaction = ?', interaction.id).first();
    }
    if (!saved) return message([text('這筆日程剛被變更，請回到單日安排重新開啟。')]);
    const until = addDays(saved.date, 1);
    const store = await snapshot(env, saved.date, until);
    const page = Math.floor(store.list(saved.date, until).findIndex(event => event.id === saved.id) / 4);
    return dayView(store, saved.date, user, page, `已${editing ? '更新' : '新增'}至 ${dateLabel(saved.date)}。`);
  }, true);
}

async function handle(env, ctx, interaction) {
  if (interaction.type === 1) {
    ctx.waitUntil(refreshBoard(env).catch(error => console.error(error.message)));
    return callback(1);
  }
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_CHANNEL_ID) return privateReply('行事曆部署設定尚未完成。');
  if (interaction.guild_id !== env.DISCORD_GUILD_ID || interaction.channel_id !== env.DISCORD_CHANNEL_ID || !interaction.member) {
    return privateReply(`請到 <#${env.DISCORD_CHANNEL_ID}> 使用行事曆。`);
  }
  const user = viewer(interaction);
  const currentDay = today();
  const currentMonth = currentDay.slice(0, 7);
  if (interaction.type === 2 && interaction.data.name === '行事曆') {
    return defer(env, ctx, interaction, async () => monthView(await monthSnapshot(env, currentMonth), currentMonth));
  }
  const [prefix, action, value, argument] = (interaction.data.custom_id ?? '').split(':');
  if (prefix !== 'wcal') return privateReply('這個操作目前無法使用。');
  if (interaction.type === 5 && ['save-edit', 'save-new'].includes(action)) return save(env, ctx, interaction, action, value, argument, user);
  if (interaction.type !== 3) return privateReply('請從置頂月曆重新開啟。');

  const month = value === 'current' ? currentMonth : value;
  const date = value === 'today' ? currentDay : value;
  const isMonth = validDate(`${month}-01`);
  switch (action) {
    case 'month':
      if (isMonth) return defer(env, ctx, interaction, async () => monthView(await monthSnapshot(env, month), month));
      break;
    case 'range':
      if (isMonth && /^[0-2]$/.test(argument)) return showInline(interaction, rangeView(month, Number(argument)));
      break;
    case 'week':
      if (isMonth && (argument === 'default' || (/^[0-5]$/.test(argument) && monthWeeks(month)[Number(argument)]))) {
        return defer(env, ctx, interaction, async () => weekView(await monthSnapshot(env, month), month, argument));
      }
      break;
    case 'day':
      if (validDate(date)) return defer(env, ctx, interaction, async () => dayView(await snapshot(env, date, addDays(date, 1)), date, user, Number(argument) || 0));
      break;
    case 'add':
      if (validDate(date)) return callback(9, eventModal(date).toJSON());
      break;
    case 'manage':
    case 'edit':
    case 'confirm':
    case 'cancel': {
      const event = await getEvent(env, value);
      if (!canEdit(event, user)) return privateReply('這筆日程已取消，或你沒有編輯權限。');
      if (action === 'edit') return callback(9, eventModal(event.date, event).toJSON());
      if (action !== 'cancel') return showInline(interaction, manageView(event, action === 'confirm'));
      return defer(env, ctx, interaction, async () => {
        const updated = await sql(env, `UPDATE events SET status = 'cancelled', revision = revision + 1
          WHERE id = ? AND revision = ? AND status = 'active'`, event.id, Number(argument)).run();
        const store = await snapshot(env, event.date, addDays(event.date, 1));
        return dayView(store, event.date, user, 0, updated.meta.changes ? '已取消日程。' : '日程剛被變更，請重新確認。');
      }, true);
    }
    case 'retry': {
      const draft = await sql(env, 'SELECT payload FROM drafts WHERE id = ? AND owner = ? AND expires > ?', value, user.id, Date.now()).first('payload');
      if (!draft) return privateReply('暫存內容已過期，請重新開啟表單。');
      const { input, previous } = JSON.parse(draft);
      if (previous && (await getEvent(env, previous.id))?.revision !== previous.revision) {
        return privateReply('這筆日程已變更，請重新開啟編輯表單。');
      }
      return callback(9, eventModal(input.date, previous, input).toJSON());
    }
  }
  return privateReply('這個按鈕已更新，請從置頂月曆重新開啟。');
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') return new Response('Cinnamoroll Calendar');
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response(null, { status: 404 });
    const body = await request.text();
    if (body.length > 32_768 || !await authentic(request, body, env.DISCORD_PUBLIC_KEY)) return new Response(null, { status: 401 });
    try {
      return await handle(env, ctx, JSON.parse(body));
    } catch (error) {
      console.error('Calendar request failed', error.message);
      return privateReply('暫時無法完成操作，請再試一次。');
    }
  },
  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      sql(env, 'DELETE FROM drafts WHERE expires <= ?', now),
      sql(env, 'DELETE FROM image_cache WHERE expires <= ?', now),
    ]);
    await refreshBoard(env);
  },
};
