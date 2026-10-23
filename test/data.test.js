import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db, tx } = await import('../src/db.js');
const data = await import('../src/data/index.js');

// node:sqlite satırları prototipsiz nesnedir; deepStrictEqual için düz nesneye çeviririz.
const plain = (v) => JSON.parse(JSON.stringify(v));
const count = (table, where = '1=1', ...params) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
const mkUser = (id) => data.createUser({ id, name: `Kullanıcı ${id}`, email: `${id}@example.com`, passwordHash: 'x' });
const mkGroup = (id, owner, code = id.toUpperCase().padEnd(8, 'X')) => data.createGroup({ id, name: `Grup ${id}`, ownerId: owner, inviteCode: code });

test('migration: tüm tablolar, indeksler ve sürüm numarası kurulur', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2, '001 ve 002 uygulanmış olmalı');
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const c of ['role', 'failed_attempts', 'locked_until']) assert.ok(userCols.includes(c), `users.${c}`);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
  assert.deepEqual(names, ['activities', 'expense_splits', 'expenses', 'groups', 'members', 'rules', 'sessions', 'settlements', 'users']);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map((r) => r.name).sort();
  assert.deepEqual(idx, ['idx_activities_group', 'idx_expenses_group']);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('kullanıcılar: CRUD ve UNIQUE e-posta kısıtı', () => {
  mkUser('a1');
  assert.equal(data.emailExists('a1@example.com'), true);
  assert.equal(data.findUserByEmail('a1@example.com').id, 'a1');
  assert.deepEqual(plain(data.findUserById('a1')), { id: 'a1', name: 'Kullanıcı a1', email: 'a1@example.com', role: 'user' });
  assert.throws(() => mkUser('a1'), /UNIQUE|PRIMARY KEY/);
  assert.throws(() => data.createUser({ id: 'a2', name: 'x', email: 'a1@example.com', passwordHash: 'x' }), /UNIQUE/);
  assert.equal(data.updateUserName('a1', 'Yeni Ad'), true);
  assert.equal(data.findUserById('a1').name, 'Yeni Ad');
  assert.equal(data.deleteUser('a1'), true);
  assert.equal(data.findUserById('a1'), undefined);
});

test('roller: varsayılan user, geçersiz rol CHECK ile reddedilir, rol değiştirilebilir', () => {
  mkUser('r1');
  assert.equal(data.findUserById('r1').role, 'user');
  assert.equal(data.setUserRole('r1', 'admin'), true);
  assert.equal(data.findUserById('r1').role, 'admin');
  assert.throws(() => data.setUserRole('r1', 'superadmin'), /CHECK/);
  assert.equal(data.setUserRole('olmayan', 'admin'), false);
  assert.throws(() => data.createUser({ id: 'r2', name: 'x', email: 'r2@example.com', passwordHash: 'x', role: 'root' }), /CHECK/);
});

test('giriş kilidi: sayaç artar, eşikte kilitlenir ve sıfırlanır; admin listesi parola özeti içermez', () => {
  mkUser('k1');
  const row = () => data.findUserAuthRow('k1');
  data.recordFailedLogin('k1', 3, 1000, 5000);
  data.recordFailedLogin('k1', 3, 1000, 5000);
  assert.equal(row().failed_attempts, 2);
  assert.equal(row().locked_until, 0);
  data.recordFailedLogin('k1', 3, 1000, 5000);
  assert.equal(row().failed_attempts, 0, 'kilitlenince sayaç sıfırlanır');
  assert.equal(row().locked_until, 6000);
  data.clearFailedLogins('k1');
  assert.equal(row().locked_until, 0);
  const listed = data.listUsersWithStats();
  assert.ok(listed.length > 0);
  for (const u of listed) assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'email', 'groupCount', 'id', 'name', 'role']);
});

test('gruplar ve üyelik: yabancı anahtar, N-N ara tablo ve cascade', () => {
  mkUser('g1'); mkUser('g2');
  assert.throws(() => mkGroup('yok', 'olmayan-kullanici'), /FOREIGN KEY/);
  mkGroup('grp', 'g1');
  assert.equal(data.addMember('grp', 'g1', 1), true);
  assert.equal(data.addMember('grp', 'g2', 2), true);
  assert.equal(data.addMember('grp', 'g2', 3), false, 'aynı üye ikinci kez eklenmez');
  assert.deepEqual(data.listMembers('grp').map((m) => m.id), ['g1', 'g2']);
  assert.equal(data.isMember('grp', 'g2'), true);
  assert.equal(data.findGroupByInvite('GRPXXXXX').id, 'grp');
  assert.equal(data.listGroupsOfUser('g2').length, 1);
  assert.throws(() => mkGroup('grp2', 'g1', 'GRPXXXXX'), /UNIQUE/, 'davet kodu benzersiz');
  assert.equal(data.renameGroup('grp', 'Yeni'), true);
  assert.equal(data.removeMember('grp', 'g2'), true);
  assert.throws(() => data.deleteUser('g1'), /FOREIGN KEY/, 'grubu olan kullanıcı silinemez');
});

test('harcamalar: pay tablosu, CHECK kısıtları ve cascade silme', () => {
  mkUser('x1'); mkUser('x2'); mkGroup('xg', 'x1');
  data.addMember('xg', 'x1'); data.addMember('xg', 'x2');
  const base = { groupId: 'xg', title: 'Market', amount: 1001, paidBy: 'x1', createdBy: 'x1', splitType: 'equal' };

  data.insertExpense({ ...base, id: 'ex1' }, { x1: 501, x2: 500 });
  data.insertExpense({ ...base, id: 'ex2', splitType: 'items', items: [{ name: 'Süt', price: 1001, to: 'all' }] }, { x1: 501, x2: 500, ziro: 0 });
  const list = data.listExpenses('xg');
  assert.equal(list.length, 2);
  const ex1 = list.find((e) => e.id === 'ex1');
  assert.deepEqual(ex1.splits, { x1: 501, x2: 500 });
  assert.equal(count('expense_splits', 'expense_id = ?', 'ex2'), 2, 'payı 0 olan satır eklenmez');
  assert.equal(JSON.parse(list.find((e) => e.id === 'ex2').items_json)[0].name, 'Süt');

  assert.throws(() => data.insertExpense({ ...base, id: 'bad1', amount: 0 }, {}), /CHECK/, 'tutar > 0 olmalı');
  assert.throws(() => data.insertExpense({ ...base, id: 'bad2', splitType: 'bilinmeyen' }, {}), /CHECK/);
  assert.throws(() => data.insertExpense({ ...base, id: 'bad3', paidBy: 'hayalet' }, {}), /FOREIGN KEY/);

  assert.equal(data.findExpense('ex1', 'xg').title, 'Market');
  assert.equal(data.findExpense('ex1', 'baska-grup'), undefined, 'başka grubun harcaması görünmez');
  assert.equal(data.updateExpenseTitle('ex1', 'Pazar'), true);
  assert.equal(data.deleteExpense('ex1'), true);
  assert.equal(count('expense_splits', 'expense_id = ?', 'ex1'), 0, 'paylar cascade ile silinir');
});

test('ödeme kaydı, kurallar (UPSERT) ve etkinlik akışı', () => {
  mkUser('y1'); mkUser('y2'); mkGroup('yg', 'y1');
  data.insertSettlement({ id: 's1', groupId: 'yg', fromUser: 'y2', toUser: 'y1', amount: 500 });
  assert.deepEqual(plain(data.listSettlements('yg')), [{ from_user: 'y2', to_user: 'y1', amount: 500 }]);
  assert.throws(() => data.insertSettlement({ id: 's2', groupId: 'yg', fromUser: 'y2', toUser: 'y1', amount: -5 }), /CHECK/);

  data.upsertRule('yg', 'süt', 'kisisel');
  data.upsertRule('yg', 'süt', 'ortak');
  assert.deepEqual(plain(data.listRules('yg')), [{ item: 'süt', kind: 'ortak' }], 'ikinci upsert güncelledi, satır çoğalmadı');
  assert.throws(() => data.upsertRule('yg', 'ekmek', 'baska'), /CHECK/);
  assert.equal(data.deleteRule('yg', 'süt'), true);

  for (let i = 1; i <= 3; i++) data.logActivity('yg', 'y1', `olay ${i}`, i);
  assert.deepEqual(data.listActivities('yg', 2).map((a) => a.message), ['olay 3', 'olay 2'], 'yeniden eskiye, limitli');
});

test('oturumlar: bir kullanıcının diğer oturumları silinir, belirtilen korunur', () => {
  mkUser('o1');
  for (const h of ['o-a', 'o-b', 'o-c']) data.createSession(h, 'o1', Date.now() + 60_000);
  assert.equal(data.deleteSessionsOfUser('o1', 'o-b'), 2);
  assert.equal(data.findUserBySession('o-b').role, 'user');
  assert.equal(data.findUserBySession('o-a'), undefined);
});

test('oturumlar: süresi dolan oturum kullanıcıyı döndürmez', () => {
  mkUser('z1');
  data.createSession('hash-gecerli', 'z1', Date.now() + 60_000);
  data.createSession('hash-eski', 'z1', Date.now() - 60_000);
  assert.equal(data.findUserBySession('hash-gecerli').id, 'z1');
  assert.equal(data.findUserBySession('hash-eski'), undefined);
  assert.equal(data.deleteExpiredSessions(), 1);
  assert.equal(data.deleteSession('hash-gecerli'), true);
});

test('transaction: hata olursa yapılan tüm yazmalar geri alınır', () => {
  mkUser('t1'); mkGroup('tg', 't1');
  data.addMember('tg', 't1');
  const before = count('expenses');
  assert.throws(() => tx(() => {
    data.insertExpense({ id: 'tx1', groupId: 'tg', title: 'ok', amount: 100, paidBy: 't1', createdBy: 't1', splitType: 'equal' }, { t1: 100 });
    data.insertExpense({ id: 'tx2', groupId: 'tg', title: 'hatalı', amount: 0, paidBy: 't1', createdBy: 't1', splitType: 'equal' }, {});
  }), /CHECK/);
  assert.equal(count('expenses'), before);
  assert.equal(count('expense_splits', 'expense_id = ?', 'tx1'), 0);
});

test('grup silinince üyelik, harcama, ödeme, kural ve etkinlikler birlikte silinir', () => {
  mkUser('d1'); mkGroup('dg', 'd1'); data.addMember('dg', 'd1');
  data.insertExpense({ id: 'dx', groupId: 'dg', title: 'a', amount: 100, paidBy: 'd1', createdBy: 'd1', splitType: 'equal' }, { d1: 100 });
  data.upsertRule('dg', 'x', 'ortak'); data.logActivity('dg', 'd1', 'm');
  assert.equal(data.deleteGroup('dg'), true);
  for (const t of ['members', 'expenses', 'rules', 'activities']) assert.equal(count(t, 'group_id = ?', 'dg'), 0, t);
  assert.equal(count('expense_splits', 'expense_id = ?', 'dx'), 0);
});
