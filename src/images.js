import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { monthLabel, monthWeeks, timeLabel } from './calendar.js';

const palette = {
  paper: '#f1f8ff', white: '#ffffff', ink: '#183958', muted: '#506c87',
  blue: '#245f96', pale: '#e0f1ff', weekend: '#eaf4ff', alert: '#95466c',
  border: '#72b8e6',
};
const [monthMascot, detailMascot] = await Promise.all(
  ['month-mascot.png', 'detail-mascot.png'].map(name =>
    loadImage(fileURLToPath(new URL(`../assets/${name}`, import.meta.url))),
  ),
);
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const fonts = '"Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
const graphemes = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });

function box(ctx, x, y, width, height, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 12);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function label(ctx, value, x, y, { size = 30, color = palette.ink, weight = 400, width } = {}) {
  ctx.font = `${weight} ${size}px ${fonts}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  let text = String(value);
  if (width && ctx.measureText(text).width > width) {
    const characters = Array.from(graphemes.segment(text), part => part.segment);
    while (characters.length && ctx.measureText(`${characters.join('')}…`).width > width) {
      characters.pop();
    }
    text = `${characters.join('')}…`;
  }
  ctx.fillText(text, x, y);
}

function page(width, height, title, subtitle, isMonth = false) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  const header = ctx.createLinearGradient(0, 0, width, 0);
  header.addColorStop(0, '#e0f1ff');
  header.addColorStop(1, '#c4e7ff');
  ctx.fillStyle = header;
  ctx.fillRect(0, 0, width, isMonth ? 191 : 146);
  if (isMonth) {
    ctx.drawImage(monthMascot, 307, 120, 1229, 830, width - 372, -11, 300, 203);
    label(ctx, 'Cinnamoroll Calendar', 39, 23, { size: 25, weight: 700, color: palette.blue });
  } else {
    ctx.drawImage(detailMascot, 40, 280, 1174, 752, width - 194, 17, 156, 100);
  }
  label(ctx, title, 36, isMonth ? 64 : 26, { size: 55, weight: 700, width: width - 240 });
  label(ctx, subtitle, 39, isMonth ? 137 : 99, { size: 26, color: palette.muted, width: width - 220 });
  return { canvas, ctx };
}

export function monthImage(month, today, events) {
  const weeks = monthWeeks(month);
  const width = 1120;
  const cellWidth = 144;
  const cellHeight = 145;
  const gap = 6;
  const gridTop = 248;
  const active = events.filter(event => event.status === 'active');
  const daysWithEvents = new Set(active.map(event => event.date)).size;
  const { canvas, ctx } = page(
    width, gridTop + weeks.length * (cellHeight + gap) + 36, monthLabel(month),
    `台北時間  ·  ${active.length} 筆日程  ·  ${daysWithEvents} 天有安排`, true,
  );

  weekdays.forEach((day, column) => {
    label(ctx, day, 38 + column * (cellWidth + gap) + 54, 207, {
      size: 30, color: column >= 5 ? palette.alert : palette.muted, weight: 700,
    });
  });

  for (const [row, dates] of weeks.entries()) {
    for (const [column, date] of dates.entries()) {
      const x = 38 + column * (cellWidth + gap);
      const y = gridTop + row * (cellHeight + gap);
      const inMonth = date.startsWith(month);
      const isToday = date === today;
      const onDay = inMonth ? active.filter(event => event.date === date) : [];
      const fill = isToday ? palette.pale : column >= 5 ? palette.weekend : palette.white;
      box(ctx, x, y, cellWidth, cellHeight, fill, isToday ? palette.border : undefined);
      label(ctx, Number(date.slice(8)), x + 10, y + 7, {
        size: 33, weight: inMonth ? 700 : 400, color: inMonth ? palette.ink : palette.muted,
      });
      if (isToday) label(ctx, '今天', x + 80, y + 14, { size: 24, color: palette.blue, weight: 700 });
      onDay.slice(0, 2).forEach((event, index) => {
        label(ctx, event.title, x + 10, y + 52 + index * 32, { size: 25, width: cellWidth - 19 });
      });
      if (onDay.length === 1) {
        label(ctx, onDay[0].start ?? '全天', x + 10, y + 87, { size: 23, color: palette.muted });
      }
      if (onDay.length > 2) {
        label(ctx, `+${onDay.length - 2} 項`, x + 10, y + 112, { size: 22, color: palette.blue });
      }
    }
  }
  return canvas.toBuffer('image/png');
}

export function detailImage({ title, subtitle, days }) {
  const width = 820;
  const height = 172 + days.reduce((sum, day) => sum + blockHeight(day), 0);
  const { canvas, ctx } = page(width, height, title, subtitle);
  let y = 155;
  for (const day of days) {
    const block = blockHeight(day) - 12;
    box(ctx, 34, y, width - 68, block, palette.white);
    label(ctx, day.label, 54, y + 17, { size: 34, weight: 700, color: palette.blue });
    if (day.events.length === 0) {
      label(ctx, day.empty ?? '沒有日程', 54, y + 64, { size: 26, color: palette.muted });
    }
    for (const [index, event] of day.events.entries()) {
      const lineY = y + 69 + index * 86;
      const status = event.status === 'cancelled' ? '已取消' : day.overlaps.has(event.id) ? '時間重疊' : '';
      const details = [status, event.location].filter(Boolean).join(' · ');
      label(ctx, timeLabel(event), 54, lineY, { size: 26, color: palette.blue });
      label(ctx, event.title, 245, lineY - 3, { size: 33, weight: 700, width: 506 });
      if (details) label(ctx, details, 245, lineY + 37, {
        size: 25, width: 506, color: status ? palette.alert : palette.muted,
      });
    }
    if (day.more) {
      label(ctx, `還有 ${day.more} 筆 · 點日期看完整清單`, 54, y + 66 + day.events.length * 86, {
        size: 25, color: palette.muted,
      });
    }
    y += block + 12;
  }
  return canvas.toBuffer('image/png');
}

function blockHeight(day) {
  return day.events.length ? 78 + day.events.length * 86 + (day.more ? 39 : 0) : 119;
}

export function renderCalendarImage(image) {
  return image.kind === 'month'
    ? monthImage(image.month, image.currentDay, image.events)
    : detailImage(image);
}
