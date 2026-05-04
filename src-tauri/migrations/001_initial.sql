CREATE TABLE IF NOT EXISTS pages (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL DEFAULT '',
  emoji       TEXT,
  parent_id   TEXT,
  content     TEXT    NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  sort_order  REAL    NOT NULL DEFAULT 0,
  database_id TEXT,
  db_cells    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS databases (
  id              TEXT PRIMARY KEY,
  columns         TEXT NOT NULL DEFAULT '[]',
  row_page_order  TEXT NOT NULL DEFAULT '[]',
  panel_state     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
