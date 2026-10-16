import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DB_PATH || 'data/ortak-gider.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys = ON');

// Grup veri modeli
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL,          -- kuruş
  paid_by TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  split_type TEXT NOT NULL,         -- equal | percent | exact | items
  items_json TEXT,                  -- fiş kalemleri (items bölüşümü için)
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share INTEGER NOT NULL,           -- kuruş
  PRIMARY KEY (expense_id, user_id)
);
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL REFERENCES users(id),
  to_user TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  kind TEXT NOT NULL,               -- ortak | kisisel
  PRIMARY KEY (group_id, item)
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_group ON activities(group_id, id);
`);

/** fn içindeki tüm yazmaları tek işlem (transaction) olarak çalıştırır. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
