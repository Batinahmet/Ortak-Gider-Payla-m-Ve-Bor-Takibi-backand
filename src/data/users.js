// Veri erişim katmanı: kullanıcılar (CRUD). Tüm sorgular hazır (parametreli) sorgudur.
import { db } from '../db.js';

// Create
export function createUser({ id, name, email, passwordHash, createdAt = Date.now() }) {
  db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)').run(
    id, name, email, passwordHash, createdAt,
  );
}

// Read
export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const emailExists = (email) => Boolean(db.prepare('SELECT 1 FROM users WHERE email = ?').get(email));
export const findUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
export const findUserById = (id) => db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id);

// Update
export const updateUserName = (id, name) => db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id).changes > 0;

// Delete (grubu olan kullanıcı silinemez: groups.owner_id yabancı anahtarı engeller)
export const deleteUser = (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
