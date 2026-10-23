// Veri erişim katmanı: kullanıcılar (CRUD), roller ve giriş kilidi. Tüm sorgular hazır (parametreli) sorgudur.
import { db } from '../db.js';

// Create (rol varsayılan olarak 'user'; admin sadece sunucu tarafında atanır)
export function createUser({ id, name, email, passwordHash, role = 'user', createdAt = Date.now() }) {
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)').run(
    id, name, email, passwordHash, role, createdAt,
  );
}

// Read
export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const emailExists = (email) => Boolean(db.prepare('SELECT 1 FROM users WHERE email = ?').get(email));
/** Parola özeti ve kilit bilgisini de içeren tam satır; sadece kimlik doğrulama kodu kullanır. */
export const findUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
export const findUserAuthRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const findUserById = (id) => db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);

/** Yönetici ekranı için: kullanıcılar ve üye oldukları grup sayısı. Parola özeti asla döndürülmez. */
export const listUsersWithStats = () =>
  db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS groupCount
       FROM users u ORDER BY u.created_at, u.id`,
    )
    .all();

// Update
export const updateUserName = (id, name) => db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id).changes > 0;
export const updateUserPassword = (id, passwordHash) =>
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id).changes > 0;
export const setUserRole = (id, role) => db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes > 0;

/**
 * Başarısız girişi sayar. Sayaç maxAttempts'e ulaşınca hesap lockMs süreyle kilitlenir ve sayaç sıfırlanır.
 * Tek UPDATE ile yapılır; iki CASE ifadesi de satırın güncelleme öncesi değerini okur.
 */
export function recordFailedLogin(id, maxAttempts, lockMs, now = Date.now()) {
  db.prepare(
    `UPDATE users SET
       failed_attempts = CASE WHEN failed_attempts + 1 >= ? THEN 0 ELSE failed_attempts + 1 END,
       locked_until    = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END
     WHERE id = ?`,
  ).run(maxAttempts, maxAttempts, now + lockMs, id);
}
export const clearFailedLogins = (id) =>
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(id);

// Delete (grubu olan kullanıcı silinemez: groups.owner_id yabancı anahtarı engeller)
export const deleteUser = (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
