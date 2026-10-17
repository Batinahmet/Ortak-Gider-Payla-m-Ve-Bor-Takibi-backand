import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DB_PATH || 'data/ortak-gider.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys = ON'); // SQLite'ta varsayılan olarak kapalıdır

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

/**
 * Migration çalıştırıcı: db/migrations/NNN_ad.sql dosyalarını sırayla uygular.
 * Uygulanan son sürüm veritabanında PRAGMA user_version olarak saklanır,
 * böylece her dosya yalnızca bir kez çalışır.
 */
function migrate() {
  const dir = new URL('../db/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  let current = db.prepare('PRAGMA user_version').get().user_version;
  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= current) continue;
    tx(() => {
      db.exec(readFileSync(new URL(file, dir), 'utf8'));
      db.exec(`PRAGMA user_version = ${version}`);
    });
    current = version;
  }
}

migrate();
