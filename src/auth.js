// Kimlik doğrulama (kim olduğunu doğrulamak) ve yetkilendirme (ne yapabileceğine karar vermek).
// Bu dosyadaki iş mantığı Express'ten bağımsızdır; test/auth.test.js doğrudan çağırır.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import * as data from './data/index.js';
import { HttpError, bad } from './errors.js';

const scryptAsync = promisify(scrypt);

const sessionDays = Number(process.env.SESSION_DAYS);
export const SESSION_MS = (sessionDays > 0 ? sessionDays : 7) * 86_400_000; // varsayılan: 7 gün
export const MAX_FAILED_LOGINS = 5; // art arda bu kadar hatalı girişte hesap kilitlenir
export const LOCK_MS = 15 * 60_000; // kilit süresi: 15 dakika
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // çok uzun parola, pahalı hash hesabıyla sunucuyu yormak için kullanılabilir

const GENERIC_LOGIN_ERROR = 'E-posta veya şifre hatalı'; // hangisinin yanlış olduğunu belli etmez
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** scrypt: parolayı yavaş ve belleği çok kullanan bir fonksiyonla özetler; her parolaya rastgele 16 baytlık tuz (salt) eklenir. */
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

// Kayıtlı olmayan e-postada da bir hash hesabı yapılır; böylece yanıt süresinden hesabın var olup olmadığı anlaşılamaz.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ??= hashPassword('zamanlama-esitleme'));

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw bad(`Şifre ${PASSWORD_MIN} ile ${PASSWORD_MAX} karakter arasında olmalı`);
  }
}

/** İstemciye gönderilebilecek alanlar. Parola özeti ve kilit bilgisi asla dışarı çıkmaz. */
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// ---------- Oturum (sunucuda tutulan, iptal edilebilir rastgele belirteç) ----------

/** Yeni oturum açar; ham belirteç sadece istemciye döner, veritabanında özeti saklanır. */
export function newSession(userId, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  data.createSession(sha256(token), userId, now + SESSION_MS);
  return token;
}

export function destroySession(token) {
  data.deleteSession(sha256(token));
}

export const purgeExpiredSessions = (now = Date.now()) => data.deleteExpiredSessions(now);

// ---------- Giriş ----------

function assertNotLocked(row, now) {
  if (row.locked_until > now) {
    const minutes = Math.ceil((row.locked_until - now) / 60_000);
    throw new HttpError(429, `Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi, ${minutes} dakika sonra tekrar dene`);
  }
}

/**
 * E-posta ve parolayla giriş. Başarısızlıkta aynı genel mesaj döner; art arda MAX_FAILED_LOGINS
 * hatada hesap LOCK_MS süreyle kilitlenir. Kilitliyken doğru parola da kabul edilmez.
 */
export async function login(email, password, now = Date.now()) {
  const user = data.findUserByEmail(email);
  if (!user) {
    await verifyPassword(password, await dummyHash());
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  assertNotLocked(user, now);
  if (!(await verifyPassword(password, user.password_hash))) {
    data.recordFailedLogin(user.id, MAX_FAILED_LOGINS, LOCK_MS, now);
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  data.clearFailedLogins(user.id);
  return { token: newSession(user.id, now), user: publicUser(user) };
}

/**
 * Şifre değiştirme: önce mevcut şifre doğrulanır (çalınmış bir oturum şifreyi değiştiremesin diye).
 * Yanlış deneme, girişteki gibi sayılır ve kilitleyebilir. Başarılı olunca bu oturum dışındaki tüm oturumlar kapatılır.
 */
export async function changePassword(user, currentPassword, newPassword, currentToken, now = Date.now()) {
  const row = data.findUserAuthRow(user.id);
  if (!row) throw new HttpError(404, 'Kullanıcı bulunamadı');
  assertNotLocked(row, now);
  if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, row.password_hash))) {
    data.recordFailedLogin(row.id, MAX_FAILED_LOGINS, LOCK_MS, now);
    throw bad('Mevcut şifre hatalı');
  }
  validatePassword(newPassword);
  if (newPassword === currentPassword) throw bad('Yeni şifre mevcut şifreyle aynı olamaz');
  data.updateUserPassword(row.id, await hashPassword(newPassword));
  data.clearFailedLogins(row.id);
  return data.deleteSessionsOfUser(row.id, sha256(currentToken)); // kapatılan diğer oturum sayısı
}

// ---------- Express ara katmanları ----------

/** Kimlik doğrulama: geçerli ve süresi dolmamış oturum belirteci yoksa 401. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const user = data.findUserBySession(sha256(token));
    if (user) {
      req.user = user;
      req.token = token;
      return next();
    }
  }
  res.status(401).json({ error: 'Giriş yapmalısın' });
}

/** Yetkilendirme: kullanıcının rolü izin verilenlerden biri değilse 403. requireAuth'tan sonra kullanılır. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Giriş yapmalısın' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Bu işlem için yetkin yok' });
  next();
};
