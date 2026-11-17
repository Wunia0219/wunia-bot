import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateRanges, monthWeeks, overlapIds, today, validateEvent } from '../src/calendar.js';
import { openCalendar } from '../src/store.js';
import { dayView, eventModal, monthView, rangeView, weekView } from '../src/views.js';
import { renderCalendarImage } from '../src/images.js';

const form = { date: '2026-11-20', title: '專案會議', time: '14:30–16:00', location: '討論室', notes: '' };
const user = { id: 'owner' };
const pngHeader = '89504e470d0a1a0a';

test('local dates and week ranges use Taipei midnight and valid calendar days', () => {
  assert.equal(today(new Date('2026-11-30T16:01:00Z')), '2026-12-01');
  assert.equal(monthWeeks('2026-11').length, 6);
  assert.equal(monthWeeks('2026-11')[0][0], '2026-10-26');
  assert.deepEqual(dateRanges('2028-02').at(-1), [21, 29]);
  assert.deepEqual(dateRanges('2026-12').at(-1), [21, 31]);
  assert.match(validateEvent({ ...form, date: '2026-02-29' }).error, /日期/);
  assert.match(validateEvent({ ...form, time: '16:00–14:00' }).error, /結束時間/);
  assert.equal(validateEvent({ ...form, time: '' }).event.start, null);
});

test('SQLite creation is idempotent and edits reject stale forms', () => {
  const store = openCalendar(':memory:');
  try {
    const { event } = validateEvent(form);
    const created = store.create(event, user.id, 'interaction');
    assert.equal(created.start, '14:30');
    assert.equal(created.end, '16:00');
    assert.equal(store.create(event, user.id, 'interaction').id, created.id);
    const moved = store.update({ ...event, date: '2026-11-21' }, created.id, 1);
    assert.equal(moved.revision, 2);
    assert.equal(store.cancel(created.id, 1), false);
    assert.equal(store.cancel(created.id, 2), true);
    assert.equal(store.list('2026-11-21', '2026-11-22')[0].status, 'cancelled');
    assert.deepEqual([...overlapIds([moved, { ...moved, id: 8, start: '15:00', end: '17:00' }])], [moved.id, 8]);
  } finally {
    store.close();
  }
});

test('mobile button rows, modal date and three image payloads are valid', () => {
  const store = openCalendar(':memory:');
  try {
    store.create(validateEvent(form).event, user.id, 'interaction');
    for (const view of [
      monthView(store, '2026-11'),
      weekView(store, '2026-11', 3),
      dayView(store, form.date, user),
    ]) {
      assert.equal(renderCalendarImage(view.image).subarray(0, 8).toString('hex'), pngHeader);
      const components = view.components.map(component => component.toJSON());
      assert.equal(components[1].items[0].media.url, 'attachment://cinnamoroll-calendar.png');
      assert.ok(components.filter(component => component.type === 1).every(row => row.components.length <= 4));
    }
    const buttons = rangeView('2026-11', 1).components.slice(1, 4)
      .flatMap(row => row.toJSON().components);
    assert.equal(buttons.length, 10);
    assert.equal(buttons.at(-1).label, '20 五');
    assert.equal(buttons.at(-1).custom_id, 'wcal:add:2026-11-20');
    assert.equal(eventModal(form.date).toJSON().custom_id, 'wcal:save-new:2026-11-20');
    assert.equal(eventModal(form.date, store.get(1)).toJSON().components.length, 5);
  } finally {
    store.close();
  }
});
