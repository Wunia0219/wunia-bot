import { monthLabel, monthWeeks, timeLabel } from './calendar.js';

const safe = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const style = `
  *{box-sizing:border-box}
  body{margin:0;color:#183958;font:25px "Noto Sans CJK TC","Noto Sans CJK SC",sans-serif}
  main{background:#f1f8ff;padding:0 36px 38px}
  header{margin:0 -36px;padding:25px 36px 28px;position:relative;background:linear-gradient(90deg,#e0f1ff,#c4e7ff);overflow:hidden}
  header img{position:absolute;object-fit:contain;right:40px;top:13px;width:166px;height:117px}
  header.month img{right:62px;top:-14px;width:310px;height:210px}
  h1,p{margin:0}
  h1{font-size:55px;line-height:1.2}
  .brand{font-size:24px;font-weight:700;color:#245f96;margin-bottom:8px}
  .sub{margin-top:9px;font-size:25px;color:#506c87}
  .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
  .weekhead{text-align:center;padding:14px 0;font-weight:700;color:#506c87}
  .weekend{color:#95466c}
  .cell{border-radius:13px;padding:8px 11px;background:white;min-height:145px;line-height:1.34}
  .cell.weekend{background:#eaf4ff;color:#183958}
  .cell.off{color:#627990;background:#e8f2fc}
  .cell.today{background:#e0f1ff;box-shadow:inset 0 0 0 3px #72b8e6}
  .num{font-size:31px;font-weight:700}
  .todayLabel,.extra{font-size:22px;color:#245f96}
  .todayLabel{float:right;padding-top:6px}
  .ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cards{display:grid;gap:12px;margin-top:15px}
  .card{background:white;border-radius:13px;padding:15px 20px}
  .date{font-size:34px;color:#245f96;font-weight:700;margin-bottom:9px}
  .item{display:grid;grid-template-columns:190px minmax(0,1fr);min-height:70px;gap:0 5px}
  .time{color:#245f96;padding-top:4px}
  .title{font-size:32px;font-weight:700}
  .detail{font-size:23px;color:#506c87}
  .warn{color:#95466c}
`;

function monthBody(data) {
  const active = data.events.filter(event => event.status === 'active');
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const heading = labels.map((name, idx) => `<div class="weekhead ${idx > 4 ? 'weekend' : ''}">${name}</div>`);
  const cells = monthWeeks(data.month).flatMap(week => week.map((date, idx) => {
    const isInMonth = date.startsWith(data.month);
    const current = date === data.currentDay;
    const events = isInMonth ? active.filter(event => event.date === date) : [];
    return `<section class="cell ${idx > 4 ? 'weekend' : ''} ${isInMonth ? '' : 'off'} ${current ? 'today' : ''}">
      ${current ? '<span class="todayLabel">今天</span>' : ''}<span class="num">${Number(date.slice(8))}</span>
      ${events.slice(0, 2).map(event => `<div class="ellipsis">${safe(event.title)}</div>`).join('')}
      ${events.length === 1 ? `<div class="extra">${safe(events[0].start ?? '全天')}</div>` : ''}
      ${events.length > 2 ? `<div class="extra">+${events.length - 2} 項</div>` : ''}
    </section>`;
  }));
  return {
    title: monthLabel(data.month),
    subtitle: `台北時間 · ${active.length} 筆日程 · ${new Set(active.map(event => event.date)).size} 天有安排`,
    body: `<div class="grid">${[...heading, ...cells].join('')}</div>`,
  };
}

function detailBody(data) {
  const cards = data.days.map(day => {
    const items = day.events.map(event => {
      const status = event.status === 'cancelled' ? '已取消' : day.overlaps.has(event.id) ? '時間重疊' : '';
      return `<div class="item">
        <div class="time">${safe(timeLabel(event))}</div>
        <div><div class="title ellipsis">${safe(event.title)}</div>
        <div class="detail ellipsis ${status ? 'warn' : ''}">${safe([status, event.location].filter(Boolean).join(' · '))}</div></div>
      </div>`;
    }).join('');
    return `<section class="card"><div class="date">${safe(day.label)}</div>
      ${items || '<p class="detail">沒有日程</p>'}
      ${day.more ? `<p class="detail">另有 ${day.more} 筆，點日期查看</p>` : ''}
    </section>`;
  });
  return { title: data.title, subtitle: data.subtitle, body: `<div class="cards">${cards.join('')}</div>` };
}

export function calendarHTML(data, art) {
  const monthly = data.kind === 'month';
  const { title, subtitle, body } = monthly ? monthBody(data) : detailBody(data);
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>${style}</style>
    <main id="calendar"><header class="${monthly ? 'month' : ''}">
      ${monthly ? '<div class="brand">Cinnamoroll Calendar</div>' : ''}
      <img alt="" src="${monthly ? art.month : art.detail}">
      <h1>${safe(title)}</h1><p class="sub">${safe(subtitle)}</p>
    </header>${body}</main></html>`;
}
