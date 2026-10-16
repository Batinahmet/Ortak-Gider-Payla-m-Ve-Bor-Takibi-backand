import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/app.js');

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
