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
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS image_cache (
  hash TEXT PRIMARY KEY,
  png BLOB NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS board (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_id TEXT,
  rendered_day TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  published_revision INTEGER NOT NULL DEFAULT 0,
  unlock_at INTEGER NOT NULL DEFAULT 0,
  branded INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0
);
INSERT INTO board(id) VALUES (1) ON CONFLICT(id) DO NOTHING;

CREATE TRIGGER IF NOT EXISTS events_created AFTER INSERT ON events
BEGIN UPDATE board SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER IF NOT EXISTS events_updated AFTER UPDATE ON events
BEGIN UPDATE board SET revision = revision + 1 WHERE id = 1; END;
