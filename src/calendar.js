export const TIME_ZONE = 'Asia/Taipei';
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function today(now = new Date()) {
  return localDate.format(now);
}

export function validDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function shiftMonth(month, offset) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function weekday(date) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function monthLabel(month) {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
}

export function dateLabel(date) {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日（${weekday(date)}）`;
}

export function monthWeeks(month) {
  const first = `${month}-01`;
  const mondayOffset = (WEEKDAYS.indexOf(weekday(first)) + 6) % 7;
  const firstMonday = addDays(first, -mondayOffset);
  const nextMonth = `${shiftMonth(month, 1)}-01`;
  const weeks = [];
  for (let monday = firstMonday; monday < nextMonth; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(monday, index)));
  }
  return weeks;
}

export function dateRanges(month) {
  const lastDay = Number(addDays(`${shiftMonth(month, 1)}-01`, -1).slice(8));
  return [[1, 10], [11, 20], [21, lastDay]];
}

export function timeLabel(event) {
  if (!event.start) return '全天';
  return event.end ? `${event.start}–${event.end}` : event.start;
}

export function validateEvent(input) {
  const event = {
    date: input.date.trim(), title: input.title.trim(), time: input.time.trim(),
    location: input.location.trim(), notes: input.notes.trim(),
  };
  if (!validDate(event.date)) return { error: '日期請填有效的 YYYY-MM-DD，例如 2026-11-20。' };
  if (!event.title || event.title.length > 80 || /[\r\n]/.test(event.title)) {
    return { error: '日程名稱請填 1～80 個字，寫在同一行。' };
  }
  if (event.location.length > 100 || /[\r\n]/.test(event.location) || event.notes.length > 500) {
    return { error: '地點最多 100 字，備註最多 500 字。' };
  }
  if (!event.time || event.time === '全天') {
    return { event: { ...event, start: null, end: null } };
  }
  const time = '([01]\\d|2[0-3]):[0-5]\\d';
  const match = event.time.match(new RegExp(`^(${time})(?:\\s*[-–～~]\\s*(${time}))?$`));
  if (!match) return { error: '時間請填「全天」、「14:30」或「14:30–16:00」。' };
  const [, start, , end] = match;
  if (end && end <= start) return { error: '結束時間須晚於開始時間。跨日行程可分兩天新增。' };
  return { event: { ...event, start, end: end ?? null } };
}

export function overlapIds(events) {
  const overlaps = new Set();
  const timed = events.filter(event => event.status === 'active' && event.start);
  for (const [index, event] of timed.entries()) {
    for (const other of timed.slice(index + 1)) {
      if (event.start === other.start ||
        (event.start < other.start && other.start < (event.end ?? event.start)) ||
        (other.start < event.start && event.start < (other.end ?? other.start))) {
        overlaps.add(event.id);
        overlaps.add(other.id);
      }
    }
  }
  return overlaps;
}
