// Veri erişim katmanı: grubun öğrenilen ortak/kişisel kalem kuralları.
import { db } from '../db.js';

export const listRules = (groupId) => db.prepare('SELECT item, kind FROM rules WHERE group_id = ?').all(groupId);

/** Kural yoksa ekler, varsa türünü günceller (UPSERT). */
export function upsertRule(groupId, item, kind) {
  db.prepare(
    'INSERT INTO rules (group_id, item, kind) VALUES (?,?,?) ON CONFLICT(group_id, item) DO UPDATE SET kind = excluded.kind',
  ).run(groupId, item, kind);
}

export const deleteRule = (groupId, item) =>
  db.prepare('DELETE FROM rules WHERE group_id = ? AND item = ?').run(groupId, item).changes > 0;
