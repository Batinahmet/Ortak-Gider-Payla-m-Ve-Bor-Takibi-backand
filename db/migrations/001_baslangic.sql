-- Migration 001: başlangıç şeması (DDL)
-- Tüm tutarlar kuruş (tam sayı) olarak saklanır. Şema ER diyagramıyla birebir aynıdır: docs/er-diyagrami.md

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

-- Kullanıcı ve grup arasındaki N-N ilişkiyi çözen ara tablo
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
  amount INTEGER NOT NULL CHECK (amount > 0),   -- kuruş
  paid_by TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  split_type TEXT NOT NULL CHECK (split_type IN ('equal', 'percent', 'exact', 'items')),
  items_json TEXT,                              -- fiş kalemleri (items bölüşümü için)
  created_at INTEGER NOT NULL
);

-- Harcama ve kullanıcı arasındaki N-N ilişkiyi çözen ara tablo; her kişinin payını taşır
CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share INTEGER NOT NULL CHECK (share >= 0),    -- kuruş
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL REFERENCES users(id),
  to_user TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),   -- kuruş
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ortak', 'kisisel')),
  PRIMARY KEY (group_id, item)
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- İndeksler: grup bazlı listeleme sorgularını hızlandırır
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_group ON activities(group_id, id);
