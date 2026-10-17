// Veri erişim katmanı: oturumlar. Veritabanında ham belirteç değil, SHA-256 özeti saklanır.
import { db } from '../db.js';

export function createSession(tokenHash, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(tokenHash, userId, expiresAt);
}

export const findUserBySession = (tokenHash, now = Date.now()) =>
  db
    .prepare(
      `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash, now);

export const deleteSession = (tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes > 0;

export const deleteExpiredSessions = (now = Date.now()) =>
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
