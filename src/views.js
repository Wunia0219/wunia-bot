import {
  ActionRowBuilder, ButtonBuilder, LabelBuilder, MediaGalleryBuilder, ModalBuilder,
  TextDisplayBuilder, TextInputBuilder,
} from '@discordjs/builders';
import { escapeMarkdown } from '@discordjs/formatters';
import { ButtonStyle, MessageFlags, TextInputStyle } from 'discord-api-types/v10';
import {
  addDays, dateLabel, dateRanges, monthLabel, monthWeeks, overlapIds, shiftMonth,
  timeLabel, today, weekday,
} from './calendar.js';
export const filename = 'cinnamoroll-calendar.png';

export function button(action, label, { style = ButtonStyle.Secondary, disabled = false } = {}) {
  return new ButtonBuilder().setCustomId(`wcal:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);
}

export const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
export const text = (content) => new TextDisplayBuilder().setContent(content);
const primary = { style: ButtonStyle.Primary };
const danger = { style: ButtonStyle.Danger };

export function message(components, image, alt) {
  const payload = { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  if (!image) return { ...payload, attachments: [] };
  return {
    ...payload,
    components: [
      components[0],
      new MediaGalleryBuilder().addItems({ media: { url: `attachment://${filename}` }, description: alt }),
      ...components.slice(1),
    ],
    image,
    attachments: [],
  };
}

function rowsOfFour(buttons) {
  const rows = [];
  for (let offset = 0; offset < buttons.length; offset += 4) {
    rows.push(row(...buttons.slice(offset, offset + 4)));
  }
  return rows;
}

const backToMonth = (month) => button(`month:${month}`, '返回月曆');
const dayButton = (date, action) => button(
  `${action}:${date}`, `${Number(date.slice(8))} ${weekday(date)}`, date === today() ? primary : undefined,
);

export function monthView(store, month) {
  const currentDay = today();
  const currentMonth = currentDay.slice(0, 7);
  const events = store.list(`${month}-01`, `${shiftMonth(month, 1)}-01`);
  const active = events.filter(event => event.status === 'active');
  const count = active.length ? `${active.length} 筆日程` : '本月尚無安排';
  return message([
    text(`## ${monthLabel(month)}｜Cinnamoroll Calendar\n${count} · 台北時間`),
    row(
      button(`month:${shiftMonth(month, -1)}`, '上個月', { disabled: month === '2000-01' }),
      button('month:current', '回本月', { disabled: month === currentMonth }),
      button(`month:${shiftMonth(month, 1)}`, '下個月', { disabled: month === '2099-12' }),
    ),
    row(
      button(`week:${month}:default`, '本月明細'),
      button('add:today', '新增今天', primary),
    ),
    text('**新增日程 · 選日期範圍**'),
    row(...dateRanges(month).map(([first, last], index) => button(`range:${month}:${index}`, `${first}–${last} 日`))),
  ], { kind: 'month', month, currentDay, events }, `${monthLabel(month)}月曆。有效日程共 ${active.length} 筆。完整文字請開啟本月明細。`);
}

export function rangeView(month, index) {
  const [first, last] = dateRanges(month)[index];
  const dates = Array.from({ length: last - first + 1 }, (_, index) => `${month}-${String(first + index).padStart(2, '0')}`);
  return message([
    text(`## 新增日程 · ${monthLabel(month)}\n${first}–${last} 日 · 點日期開啟表單`),
    ...rowsOfFour(dates.map(date => dayButton(date, 'add'))),
    row(backToMonth(month)),
  ]);
}

function eventLine(event, overlaps) {
  const status = event.status === 'cancelled' ? ' · 已取消' : overlaps.has(event.id) ? ' · 時間重疊' : '';
  return `${timeLabel(event)}　**${escapeMarkdown(event.title)}**${status}`;
}

export function weekView(store, month, requestedWeek) {
  const weeks = monthWeeks(month);
  const currentWeek = weeks.findIndex(week => week.includes(today()) && today().startsWith(month));
  const index = requestedWeek === 'default' ? Math.max(0, currentWeek) : Number(requestedWeek);
  const dates = weeks[index].filter(date => date.startsWith(month));
  const events = store.list(dates[0], addDays(dates.at(-1), 1));
  const heading = `${dateLabel(dates[0])} – ${dateLabel(dates.at(-1))}`;
  const days = dates.map(date => {
    const onDay = events.filter(event => event.date === date);
    return { label: dateLabel(date), events: onDay.slice(0, 3), more: Math.max(0, onDay.length - 3), overlaps: overlapIds(onDay) };
  });
  return message([
    text(`## ${monthLabel(month)} · 每週明細\n${heading} · ${index + 1} / ${weeks.length} 週 · 台北時間`),
    text('**查看單日完整安排**'),
    ...rowsOfFour(dates.map(date => dayButton(date, 'day'))),
    row(
      button(`week:${month}:${index - 1}`, '上一週', { disabled: index === 0 }),
      backToMonth(month),
      button(`week:${month}:${index + 1}`, '下一週', { disabled: index === weeks.length - 1 }),
    ),
    ...days.map(day => text([
      `**${day.label}**`,
      ...day.events.map(event => [eventLine(event, day.overlaps), event.location && escapeMarkdown(event.location)].filter(Boolean).join(' · ')),
      ...(day.events.length === 0 ? ['沒有日程'] : []),
      ...(day.more ? [`另有 ${day.more} 筆，點日期查看`] : []),
    ].join('\n'))),
  ], { kind: 'detail', title: '每週明細', subtitle: heading, days }, `${heading} 的每週行程，文字版列在圖片下方。`);
}

export function dayView(store, date, user, requestedPage = 0, notice = '') {
  const events = store.list(date, addDays(date, 1));
  const overlaps = overlapIds(events);
  const pageCount = Math.max(1, Math.ceil(events.length / 4));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const visible = events.slice(page * 4, (page + 1) * 4);
  const month = date.slice(0, 7);
  const week = monthWeeks(month).findIndex(dates => dates.includes(date));
  const actions = visible.flatMap((event, index) =>
    event.status === 'active' && (event.owner === user.id || user.canManage)
      ? [button(`manage:${event.id}`, `管理第 ${page * 4 + index + 1} 筆`)]
      : [],
  );
  return message([
    text([
      `## ${dateLabel(date)} · 單日安排`,
      `${events.length} 筆 · 台北時間${pageCount > 1 ? ` · 第 ${page + 1} / ${pageCount} 頁` : ''}`,
      notice,
      ...(events.length === 0 ? ['這一天還沒有日程。'] : []),
    ].filter(Boolean).join('\n')),
    ...visible.map((event, index) => text([
      `${page * 4 + index + 1}. ${eventLine(event, overlaps)}`,
      event.location && `地點  ${escapeMarkdown(event.location)}`,
      event.notes && escapeMarkdown(event.notes),
    ].filter(Boolean).join('\n'))),
    ...(actions.length ? [row(...actions)] : []),
    row(button(`add:${date}`, '新增這天的日程', primary), button(`week:${month}:${week}`, '返回每週明細')),
    ...(pageCount > 1 ? [row(
      button(`day:${date}:${page - 1}`, '上一頁', { disabled: page === 0 }),
      button(`day:${date}:${page + 1}`, '下一頁', { disabled: page === pageCount - 1 }),
    )] : []),
  ], {
    kind: 'detail', title: dateLabel(date), subtitle: `台北時間 · ${events.length} 筆日程`,
    days: [{ label: pageCount > 1 ? `第 ${page + 1} / ${pageCount} 頁` : '當天時段', events: visible, overlaps }],
  }, `${dateLabel(date)}的單日行程，完整文字與備註列在圖片下方。`);
}

export function manageView(event, confirming = false) {
  const date = dateLabel(event.date);
  return message([
    text(`## ${confirming ? '確認取消日程' : '管理日程'}\n${date} · ${eventLine(event, new Set())}`),
    confirming
      ? row(button(`manage:${event.id}`, '返回'), button(`cancel:${event.id}:${event.revision}`, '確認取消', danger))
      : row(button(`day:${event.date}`, '返回單日'), button(`edit:${event.id}`, '編輯或改期', primary), button(`confirm:${event.id}`, '取消日程', danger)),
  ]);
}

function field(id, label, { value = '', placeholder, required = false, max, paragraph = false }) {
  const input = new TextInputBuilder().setCustomId(id)
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required).setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  if (value) input.setValue(value);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

export function eventModal(date, event, draft = {}) {
  const modal = new ModalBuilder()
    .setCustomId(event ? `wcal:save-edit:${event.id}:${event.revision}` : `wcal:save-new:${date}`)
    .setTitle(event ? '編輯或改期 · 台北時間' : `新增 ${dateLabel(date)}的日程`);
  modal.addLabelComponents(field('title', '日程名稱', { value: draft.title ?? event?.title, required: true, max: 80 }));
  if (event) modal.addLabelComponents(field('date', '日期（YYYY-MM-DD）', { value: draft.date ?? event.date, required: true, max: 10 }));
  return modal.addLabelComponents(
    field('time', '時間 · 台北時間（留白為全天）', {
      value: draft.time ?? (event ? timeLabel(event) : ''), placeholder: '例如 14:30 或 14:30–16:00', max: 32,
    }),
    field('location', '地點', { value: draft.location ?? event?.location, max: 100 }),
    field('notes', '備註', { value: draft.notes ?? event?.notes, max: 500, paragraph: true }),
  );
}
