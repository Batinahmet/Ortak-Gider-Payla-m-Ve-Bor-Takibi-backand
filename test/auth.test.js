// Kimlik doğrulama ve yetkilendirme testleri. Express gerektirmez: iş mantığı doğrudan çağrılır.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const data = await import('../src/data/index.js');
const auth = await import('../src/auth.js');
const { HttpError } = await import('../src/errors.js');

const sha = (t) => createHash('sha256').update(t).digest('hex');
const makeUser = async (id, password = 'dogru-sifre-1', role = 'user') => {
  data.createUser({ id, name: `K ${id}`, email: `${id}@example.com`, passwordHash: await auth.hashPassword(password), role });
  return `${id}@example.com`;
};
const rejects = (promise, status, re) =>
  assert.rejects(promise, (e) => e instanceof HttpError && e.status === status && (!re || re.test(e.message)));

test('parola: düz metin saklanmaz, aynı parola farklı tuzla farklı özet üretir', async () => {
  const a = await auth.hashPassword('merhaba-dunya');
  const b = await auth.hashPassword('merhaba-dunya');
  assert.notEqual(a, b, 'rastgele tuz');
  assert.ok(!a.includes('merhaba-dunya'));
  assert.match(a, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'tuz:özet');
  assert.equal(await auth.verifyPassword('merhaba-dunya', a), true);
  assert.equal(await auth.verifyPassword('merhaba-dunyA', a), false);
});

test('parola kuralı: 8-128 karakter', () => {
  assert.throws(() => auth.validatePassword('kisa'), /8 ile 128/);
  assert.throws(() => auth.validatePassword('x'.repeat(129)), /8 ile 128/);
  assert.throws(() => auth.validatePassword(12345678));
  assert.doesNotThrow(() => auth.validatePassword('x'.repeat(8)));
});

test('giriş: başarılıysa belirteç ve rol döner; veritabanında ham belirteç değil özeti saklanır', async () => {
  const email = await makeUser('g1');
  const { token, user } = await auth.login(email, 'dogru-sifre-1');
  assert.equal(token.length, 64);
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name', 'role'], 'parola özeti sızmaz');
  assert.equal(user.role, 'user');
  const stored = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all('g1').map((r) => r.token_hash);
  assert.ok(stored.includes(sha(token)));
  assert.ok(!stored.includes(token));
});

test('giriş: hatalı parola ve olmayan e-posta aynı genel mesajı verir', async () => {
  const email = await makeUser('g2');
  let m1, m2;
  await assert.rejects(auth.login(email, 'yanlis'), (e) => { m1 = e.message; return e.status === 401; });
  await assert.rejects(auth.login('yok@example.com', 'yanlis'), (e) => { m2 = e.message; return e.status === 401; });
  assert.equal(m1, m2, 'hesabın var olup olmadığı belli olmaz');
});

test('giriş kilidi: 5 hatalı denemede kilitlenir, doğru parola da kabul edilmez, süre dolunca açılır', async () => {
  const email = await makeUser('l1');
  const t0 = 1_000_000;
  for (let i = 0; i < auth.MAX_FAILED_LOGINS; i++) await rejects(auth.login(email, 'yanlis', t0 + i), 401);
  await rejects(auth.login(email, 'dogru-sifre-1', t0 + 10), 429, /15 dakika/);
  await rejects(auth.login(email, 'yanlis', t0 + 20), 429);
  const sonra = t0 + 4 + auth.LOCK_MS + 1; // son hatalı denemeden 15 dk sonra
  const ok = await auth.login(email, 'dogru-sifre-1', sonra);
  assert.equal(ok.user.id, 'l1');
  const row = data.findUserAuthRow('l1');
  assert.equal(row.failed_attempts, 0);
  assert.equal(row.locked_until, 0);
});

test('giriş kilidi: başarılı giriş hatalı deneme sayacını sıfırlar', async () => {
  const email = await makeUser('l2');
  for (let i = 0; i < 4; i++) await rejects(auth.login(email, 'yanlis'), 401);
  await auth.login(email, 'dogru-sifre-1');
  for (let i = 0; i < 4; i++) await rejects(auth.login(email, 'yanlis'), 401); // 4 daha: hâlâ kilitlenmedi
  await auth.login(email, 'dogru-sifre-1');
});

test('oturum: süresi dolunca geçersiz olur, temizleme süresi dolanları siler', async () => {
  await makeUser('s1');
  const now = Date.now();
  const token = auth.newSession('s1', now - auth.SESSION_MS - 1000); // süresi 1 sn önce dolmuş
  assert.equal(data.findUserBySession(sha(token)), undefined);
  const live = auth.newSession('s1');
  assert.equal(data.findUserBySession(sha(live)).id, 's1');
  assert.ok(auth.purgeExpiredSessions() >= 1);
  assert.equal(data.findUserBySession(sha(live)).id, 's1', 'geçerli oturum silinmez');
  auth.destroySession(live);
  assert.equal(data.findUserBySession(sha(live)), undefined, 'çıkış oturumu kapatır');
});

test('şifre değiştirme: mevcut şifre şart, başarıda diğer oturumlar kapanır, yeni şifreyle girilir', async () => {
  const email = await makeUser('p1');
  const a = (await auth.login(email, 'dogru-sifre-1')).token; // bu cihaz
  const b = (await auth.login(email, 'dogru-sifre-1')).token; // başka cihaz
  const user = data.findUserById('p1');

  await rejects(auth.changePassword(user, 'yanlis-mevcut', 'yeni-sifre-99', a), 400, /Mevcut şifre/);
  await rejects(auth.changePassword(user, 'dogru-sifre-1', 'kisa', a), 400, /8 ile 128/);
  await rejects(auth.changePassword(user, 'dogru-sifre-1', 'dogru-sifre-1', a), 400, /aynı/);

  const closed = await auth.changePassword(user, 'dogru-sifre-1', 'yeni-sifre-99', a);
  assert.ok(closed >= 1);
  assert.equal(data.findUserBySession(sha(a)).id, 'p1', 'şu anki oturum açık kalır');
  assert.equal(data.findUserBySession(sha(b)), undefined, 'diğer cihazdaki oturum kapanır');
  await rejects(auth.login(email, 'dogru-sifre-1'), 401);
  assert.equal((await auth.login(email, 'yeni-sifre-99')).user.id, 'p1');
});

test('şifre değiştirme: yanlış mevcut şifre denemeleri de hesabı kilitler', async () => {
  const email = await makeUser('p2');
  const { token } = await auth.login(email, 'dogru-sifre-1');
  const user = data.findUserById('p2');
  for (let i = 0; i < auth.MAX_FAILED_LOGINS; i++) await rejects(auth.changePassword(user, 'yanlis', 'yeni-sifre-99', token), 400);
  await rejects(auth.changePassword(user, 'dogru-sifre-1', 'yeni-sifre-99', token), 429);
});

// ---- Rol tabanlı erişim (Express'siz, sahte req/res ile) ----
const fakeRes = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const run = (mw, req) => {
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

test('requireRole: oturumsuz 401, yetkisiz rol 403, doğru rol geçer', () => {
  const adminOnly = auth.requireRole('admin');
  let out = run(adminOnly, {});
  assert.equal(out.res.code, 401);
  assert.equal(out.nextCalled, false);
  out = run(adminOnly, { user: { role: 'user' } });
  assert.equal(out.res.code, 403);
  assert.equal(out.nextCalled, false);
  out = run(adminOnly, { user: { role: 'admin' } });
  assert.equal(out.nextCalled, true);
  assert.equal(run(auth.requireRole('admin', 'user'), { user: { role: 'user' } }).nextCalled, true);
});

test('requireAuth: belirteç yok/geçersiz/süresi dolmuş 401, geçerli olan kullanıcıyı rolüyle ekler', async () => {
  await makeUser('a1', 'dogru-sifre-1', 'admin');
  const { token } = await auth.login('a1@example.com', 'dogru-sifre-1');
  const hdr = (v) => ({ get: (h) => (h.toLowerCase() === 'authorization' ? v : undefined) });
  assert.equal(run(auth.requireAuth, hdr(undefined)).res.code, 401);
  assert.equal(run(auth.requireAuth, hdr('Bearer uydurma')).res.code, 401);
  assert.equal(run(auth.requireAuth, hdr(token)).res.code, 401, 'Bearer öneki şart');
  const expired = auth.newSession('a1', Date.now() - auth.SESSION_MS - 1000);
  assert.equal(run(auth.requireAuth, hdr(`Bearer ${expired}`)).res.code, 401);
  const req = hdr(`Bearer ${token}`);
  const out = run(auth.requireAuth, req);
  assert.equal(out.nextCalled, true);
  assert.equal(req.user.role, 'admin');
});
