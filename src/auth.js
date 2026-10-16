import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** Yeni oturum açar; ham belirteç sadece istemciye döner, veritabanında özeti saklanır. */
export function newSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + SESSION_MS,
  );
  return token;
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), Date.now());
    if (row) {
      req.user = row;
      req.token = token;
      return next();
    }
  }
  res.status(401).json({ error: 'Giriş yapmalısın' });
}
