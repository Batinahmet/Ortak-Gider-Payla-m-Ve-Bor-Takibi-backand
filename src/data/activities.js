// Veri erişim katmanı: etkinlik akışı (bildirim kaynağı).
import { db } from '../db.js';

export function logActivity(groupId, actorId, message, createdAt = Date.now()) {
  db.prepare('INSERT INTO activities (group_id, actor_id, message, created_at) VALUES (?,?,?,?)').run(
    groupId, actorId, message, createdAt,
  );
}

export const listActivities = (groupId, limit = 50) =>
  db
    .prepare('SELECT message, created_at AS createdAt FROM activities WHERE group_id = ? ORDER BY id DESC LIMIT ?')
    .all(groupId, limit);
