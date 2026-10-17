// Veri erişim katmanı: gruplar ve üyelik (members ara tablosu).
import { db } from '../db.js';

// Create
export function createGroup({ id, name, ownerId, inviteCode, createdAt = Date.now() }) {
  db.prepare('INSERT INTO groups (id, name, owner_id, invite_code, created_at) VALUES (?,?,?,?,?)').run(
    id, name, ownerId, inviteCode, createdAt,
  );
}

/** Üye ekler; kişi zaten üyeyse hiçbir şey yapmaz. Yeni eklendiyse true döner. */
export const addMember = (groupId, userId, joinedAt = Date.now()) =>
  db.prepare('INSERT OR IGNORE INTO members (group_id, user_id, joined_at) VALUES (?,?,?)').run(groupId, userId, joinedAt).changes > 0;

// Read
export const findGroup = (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
export const findGroupByInvite = (code) => db.prepare('SELECT id, name FROM groups WHERE invite_code = ?').get(code);

export const listGroupsOfUser = (userId) =>
  db
    .prepare(
      `SELECT g.id, g.name FROM groups g JOIN members m ON m.group_id = g.id
       WHERE m.user_id = ? ORDER BY g.created_at DESC`,
    )
    .all(userId);

export const isMember = (groupId, userId) =>
  Boolean(db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(groupId, userId));

export const listMembers = (groupId) =>
  db
    .prepare('SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.joined_at')
    .all(groupId);

// Update
export const renameGroup = (id, name) => db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id).changes > 0;

// Delete (üyelik, harcama, ödeme, kural ve etkinlikler ON DELETE CASCADE ile birlikte silinir)
export const removeMember = (groupId, userId) =>
  db.prepare('DELETE FROM members WHERE group_id = ? AND user_id = ?').run(groupId, userId).changes > 0;
export const deleteGroup = (id) => db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes > 0;
