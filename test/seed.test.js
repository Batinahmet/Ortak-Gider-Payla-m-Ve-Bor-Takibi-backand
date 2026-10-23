import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const data = await import('../src/data/index.js');
const { seed, dumpSql, TABLES } = await import('../db/seed.js');
const { computeBalances } = await import('../src/split.js');
const { verifyPassword } = await import('../src/auth.js');

test('örnek veri: tablolar dolu, yabancı anahtarlar tutarlı', async () => {
  const counts = await seed();
  assert.deepEqual(counts, { users: 5, sessions: 0, groups: 2, members: 7, expenses: 7, expense_splits: counts.expense_splits, settlements: 2, rules: 3, activities: counts.activities });
  assert.ok(counts.expense_splits >= 20 && counts.activities >= 9);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('örnek veri: her harcamanın payları tutara eşit, bakiyeler toplamı sıfır', () => {
  for (const g of ['g_ev', 'g_tatil']) {
    const members = data.listMembers(g).map((m) => m.id);
    const expenses = data.listExpenses(g);
    for (const e of expenses) {
      assert.equal(Object.values(e.splits).reduce((a, b) => a + b, 0), e.amount, `${e.id} paylar toplamı`);
    }
    const bal = computeBalances(members, expenses, data.listSettlements(g));
    assert.equal(Object.values(bal).reduce((a, b) => a + b, 0), 0, `${g} bakiye toplamı`);
  }
});

test('örnek veri: dört bölüşüm tipinin hepsi var', () => {
  const types = new Set(db.prepare('SELECT DISTINCT split_type FROM expenses').all().map((r) => r.split_type));
  assert.deepEqual([...types].sort(), ['equal', 'exact', 'items', 'percent']);
});

test('roller: tek yönetici var, diğerleri kullanıcı, yönetici hiçbir gruba üye değil', () => {
  const roles = db.prepare('SELECT email, role FROM users ORDER BY email').all().map((r) => `${r.email}:${r.role}`);
  assert.deepEqual(roles, ['admin@example.com:admin', 'ayse@example.com:user', 'can@example.com:user', 'mehmet@example.com:user', 'zeynep@example.com:user']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM members WHERE user_id = 'u_admin'").get().n, 0);
});

test('KVKK: tüm e-postalar example.com alanında, şifreler özetli saklanır', async () => {
  const rows = db.prepare('SELECT email, password_hash FROM users').all();
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.match(r.email, /@example\.com$/);
    assert.notEqual(r.password_hash, 'demo12345');
  }
  assert.equal(await verifyPassword('demo12345', rows[0].password_hash), true);
});

test('ikinci çalıştırma reset olmadan reddedilir, reset ile temiz doldurur', async () => {
  await assert.rejects(() => seed(), /boş değil/);
  const counts = await seed({ reset: true });
  assert.equal(counts.users, 5);
  assert.equal(counts.expenses, 7);
});

test('SQL dökümü: temiz bir veritabanına yüklenince aynı veriyi üretir', () => {
  const sql = dumpSql();
  assert.match(sql, /INSERT INTO users/);
  const fresh = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../db/migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
    fresh.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  }
  fresh.exec(sql);
  for (const t of TABLES) {
    const a = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const b = fresh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    assert.equal(b, a, `${t} satır sayısı`);
  }
  assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(), []);
});
