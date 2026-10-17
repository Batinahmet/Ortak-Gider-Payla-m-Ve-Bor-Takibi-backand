// Veri erişim katmanı: harcamalar ve paylar (expense_splits ara tablosu).
// Not: Bu fonksiyonlar kendi transaction'larını açmaz; birden çok yazmayı atomik yapmak için
// çağıran taraf tx() (src/db.js) içinde kullanır.
import { db } from '../db.js';

/** Harcamayı ve kişi başı paylarını ekler. shares: { kullaniciId: kuruş } */
export function insertExpense(e, shares) {
  db.prepare(
    'INSERT INTO expenses (id, group_id, title, amount, paid_by, created_by, split_type, items_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    e.id, e.groupId, e.title, e.amount, e.paidBy, e.createdBy, e.splitType,
    e.items ? JSON.stringify(e.items) : null, e.createdAt ?? Date.now(),
  );
  const ins = db.prepare('INSERT INTO expense_splits (expense_id, user_id, share) VALUES (?,?,?)');
  for (const [userId, share] of Object.entries(shares)) if (share > 0) ins.run(e.id, userId, share);
}

/** Bir grubun harcamaları (yeniden eskiye), her biri splits: { kullaniciId: pay } ile. */
export function listExpenses(groupId) {
  const rows = db.prepare('SELECT * FROM expenses WHERE group_id = ? ORDER BY created_at DESC, id DESC').all(groupId);
  const splits = db
    .prepare(
      'SELECT s.expense_id, s.user_id, s.share FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?',
    )
    .all(groupId);
  const byExpense = {};
  for (const s of splits) (byExpense[s.expense_id] ||= {})[s.user_id] = s.share;
  return rows.map((e) => ({ ...e, splits: byExpense[e.id] || {} }));
}

export const findExpense = (id, groupId) =>
  db.prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?').get(id, groupId);

export const updateExpenseTitle = (id, title) =>
  db.prepare('UPDATE expenses SET title = ? WHERE id = ?').run(title, id).changes > 0;

/** Harcamayı siler; payları ON DELETE CASCADE ile otomatik silinir. */
export const deleteExpense = (id) => db.prepare('DELETE FROM expenses WHERE id = ?').run(id).changes > 0;
