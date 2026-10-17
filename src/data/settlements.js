// Veri erişim katmanı: ödeme kayıtları ("borcumu ödedim").
import { db } from '../db.js';

export function insertSettlement({ id, groupId, fromUser, toUser, amount, createdAt = Date.now() }) {
  db.prepare('INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_at) VALUES (?,?,?,?,?,?)').run(
    id, groupId, fromUser, toUser, amount, createdAt,
  );
}

export const listSettlements = (groupId) =>
  db.prepare('SELECT from_user, to_user, amount FROM settlements WHERE group_id = ?').all(groupId);
