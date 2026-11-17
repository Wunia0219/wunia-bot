import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openCalendar(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      start TEXT,
      end TEXT,
      location TEXT NOT NULL,
      notes TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_interaction TEXT UNIQUE NOT NULL
    );
    CREATE INDEX IF NOT EXISTS event_dates ON events(date, status, start);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const list = db.prepare(`
    SELECT * FROM events WHERE date >= ? AND date < ?
    ORDER BY date, (status = 'cancelled'), start, id
  `);
  const get = db.prepare('SELECT * FROM events WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO events (date, title, start, end, location, notes, owner, created_interaction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(created_interaction) DO NOTHING
  `);
  const byInteraction = db.prepare('SELECT * FROM events WHERE created_interaction = ?');
  const update = db.prepare(`
    UPDATE events SET date = ?, title = ?, start = ?, end = ?, location = ?, notes = ?,
      revision = revision + 1
    WHERE id = ? AND revision = ? AND status = 'active'
  `);
  const cancel = db.prepare(`
    UPDATE events SET status = 'cancelled', revision = revision + 1
    WHERE id = ? AND revision = ? AND status = 'active'
  `);
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const saveSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const fields = (event) => [event.date, event.title, event.start, event.end, event.location, event.notes];

  return {
    list: (from, until) => list.all(from, until),
    get: (id) => get.get(id),
    create(event, owner, interactionId) {
      insert.run(...fields(event), owner, interactionId);
      return byInteraction.get(interactionId);
    },
    update(event, id, revision) {
      return update.run(...fields(event), id, revision).changes ? get.get(id) : null;
    },
    cancel: (id, revision) => Boolean(cancel.run(id, revision).changes),
    setting: (key) => getSetting.get(key)?.value,
    setSetting: (key, value) => saveSetting.run(key, value),
    close: () => db.close(),
  };
}
