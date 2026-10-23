import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.AUTH_RATE_LIMIT = '1000'; // bu dosyadaki testler aynı IP'den çok sayıda giriş yapar
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/app.js');
const data = await import('../src/data/index.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

test('uçtan uca: kayıt, grup, davet, harcama, bakiye, ödeme', async () => {
  const ali = (await call('POST', '/auth/register', { name: 'Ali', email: 'ali@example.com', password: 'sifre1234' })).data;
  const veli = (await call('POST', '/auth/register', { name: 'Veli', email: 'veli@example.com', password: 'sifre1234' })).data;

  assert.equal((await call('POST', '/auth/login', { email: 'ali@example.com', password: 'yanlis-sifre' })).status, 401);
  assert.equal((await call('GET', '/groups')).status, 401);

  const g = (await call('POST', '/groups', { name: 'Ev' }, ali.token)).data;
  const info = (await call('GET', `/groups/${g.id}`, null, ali.token)).data;
  assert.equal(info.members.length, 1);

  // Üye olmayan gruba erişemez
  assert.equal((await call('GET', `/groups/${g.id}`, null, veli.token)).status, 404);
  const joined = await call('POST', '/groups/join', { code: info.inviteCode }, veli.token);
  assert.equal(joined.status, 200);

  // Ali 3001 kuruş ödedi, iki kişi eşit böler
  const exp = await call('POST', `/groups/${g.id}/expenses`, { title: 'Market', amount: 3001 }, ali.token);
  assert.equal(exp.status, 201);

  const { balances, transfers } = (await call('GET', `/groups/${g.id}/balances`, null, veli.token)).data;
  assert.equal(balances[ali.user.id] + balances[veli.user.id], 0);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].from, veli.user.id);
  assert.equal(transfers[0].to, ali.user.id);

  // Veli borcunu öder, hesap denkleşir
  await call('POST', `/groups/${g.id}/settlements`, { to: ali.user.id, amount: transfers[0].amount }, veli.token);
  const after = (await call('GET', `/groups/${g.id}/balances`, null, ali.token)).data;
  assert.equal(after.transfers.length, 0);

  // Geçersiz girdiler reddedilir
  assert.equal((await call('POST', `/groups/${g.id}/expenses`, { title: 'x', amount: 12.5 }, ali.token)).status, 400);
  assert.equal((await call('POST', `/groups/${g.id}/expenses`, { title: 'x', amount: 100, participants: ['yabanci'] }, ali.token)).status, 400);

  // Yapay zeka anahtarı yoksa uçlar 503 verir
  assert.equal((await call('POST', `/groups/${g.id}/summary`, {}, ali.token)).status, 503);

  // Kalem bazlı harcama + öğrenilen kural
  const items = await call('POST', `/groups/${g.id}/expenses`, {
    title: 'Fiş',
    splitType: 'items',
    items: [{ name: 'Süt', price: 1000, to: 'all' }, { name: 'Şampuan', price: 600, to: [veli.user.id] }],
  }, ali.token);
  assert.equal(items.status, 201);
  assert.equal((await call('POST', `/groups/${g.id}/rules`, { item: 'Süt', kind: 'ortak' }, ali.token)).status, 200);
  assert.deepEqual((await call('GET', `/groups/${g.id}/rules`, null, ali.token)).data.rules, [{ item: 'süt', kind: 'ortak' }]);
  assert.ok((await call('GET', `/groups/${g.id}/activity`, null, ali.token)).data.activity.length >= 3);
});

const register = async (name, email) =>
  (await call('POST', '/auth/register', { name, email, password: 'sifre1234' })).data;

test('rol: kayıt isteğindeki role alanı yok sayılır (mass assignment), yeni kullanıcı daima user', async () => {
  const r = await call('POST', '/auth/register', { name: 'Sinsi', email: 'sinsi@example.com', password: 'sifre1234', role: 'admin' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
  assert.equal(data.findUserById(r.data.user.id).role, 'user');
  assert.equal((await call('GET', '/admin/users', null, r.data.token)).status, 403);
});

test('rol tabanlı erişim: oturumsuz 401, kullanıcı 403, yönetici 200; rol her istekte veritabanından okunur', async () => {
  const user = await register('Normal', 'normal@example.com');
  const boss = await register('Patron', 'patron@example.com');
  data.setUserRole(boss.user.id, 'admin'); // ilk yönetici sunucu tarafında atanır

  assert.equal((await call('GET', '/admin/users')).status, 401);
  assert.equal((await call('GET', '/admin/users', null, user.token)).status, 403);
  assert.equal((await call('PATCH', `/admin/users/${user.user.id}/role`, { role: 'admin' }, user.token)).status, 403, 'kullanıcı kendini yönetici yapamaz');
  assert.equal(data.findUserById(user.user.id).role, 'user');

  const list = await call('GET', '/admin/users', null, boss.token);
  assert.equal(list.status, 200);
  assert.ok(list.data.users.length >= 2);
  for (const u of list.data.users) {
    assert.ok(!('password_hash' in u) && !('passwordHash' in u), 'parola özeti sızmaz');
    assert.ok('groupCount' in u);
  }

  assert.equal((await call('PATCH', `/admin/users/${user.user.id}/role`, { role: 'superadmin' }, boss.token)).status, 400);
  assert.equal((await call('PATCH', `/admin/users/${boss.user.id}/role`, { role: 'user' }, boss.token)).status, 400, 'kendi rolünü değiştiremez');
  assert.equal((await call('PATCH', '/admin/users/yok/role', { role: 'user' }, boss.token)).status, 404);
  assert.equal((await call('PATCH', `/admin/users/${user.user.id}/role`, { role: 'admin' }, boss.token)).status, 200);
  assert.equal((await call('GET', '/admin/users', null, user.token)).status, 200, 'yeni yönetici aynı oturumla erişir');
  data.setUserRole(user.user.id, 'user');
  assert.equal((await call('GET', '/admin/users', null, user.token)).status, 403, 'yetki geri alınınca erişim hemen kesilir');
});

test('giriş kilidi: 5 hatalı denemeden sonra doğru parola da 429 döner', async () => {
  await register('Kilit', 'kilit@example.com');
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/auth/login', { email: 'kilit@example.com', password: 'yanlis-sifre' });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'E-posta veya şifre hatalı');
  }
  const locked = await call('POST', '/auth/login', { email: 'kilit@example.com', password: 'sifre1234' });
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /kilitlendi/);
  assert.equal((await call('POST', '/auth/login', { email: 'yok@example.com', password: 'x' })).data.error, 'E-posta veya şifre hatalı');
});

test('profil: ad değiştirme ve şifre değiştirme (diğer oturumlar kapanır)', async () => {
  await register('Profil', 'profil@example.com');
  const login = async () => (await call('POST', '/auth/login', { email: 'profil@example.com', password: 'sifre1234' })).data;
  const a = await login();
  const b = await login();

  const renamed = await call('PATCH', '/me', { name: 'Yeni Ad' }, a.token);
  assert.equal(renamed.status, 200);
  assert.equal((await call('GET', '/me', null, a.token)).data.user.name, 'Yeni Ad');
  assert.equal((await call('PATCH', '/me', { name: '   ' }, a.token)).status, 400);
  assert.equal((await call('PATCH', '/me', { name: 'x' })).status, 401);

  assert.equal((await call('POST', '/me/password', { currentPassword: 'yanlis', newPassword: 'yeni-sifre-99' }, a.token)).status, 400);
  assert.equal((await call('POST', '/me/password', { currentPassword: 'sifre1234', newPassword: 'kisa' }, a.token)).status, 400);
  const ok = await call('POST', '/me/password', { currentPassword: 'sifre1234', newPassword: 'yeni-sifre-99' }, a.token);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.closedSessions >= 1);
  assert.equal((await call('GET', '/me', null, a.token)).status, 200, 'bu oturum açık');
  assert.equal((await call('GET', '/me', null, b.token)).status, 401, 'diğer oturum kapandı');
  assert.equal((await call('POST', '/auth/login', { email: 'profil@example.com', password: 'sifre1234' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'profil@example.com', password: 'yeni-sifre-99' })).status, 200);
});
