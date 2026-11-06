import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettlement, validateMemberRemoval, assertOwner, assertAmount, MAX_AMOUNT } from '../src/business-rules.js';
import { computeBalances, minimizeTransfers, splitEqual, splitPercent, splitExact, splitItems } from '../src/split.js';

const fails = (fn, status, re) => assert.throws(fn, (e) => e.status === status && re.test(e.message));
const bal = { ali: 5000, veli: -3000, can: -2000 }; // Ali alacaklı, Veli ve Can borçlu

test('tutar kuralı: sıfır, negatif, kesirli ve çok büyük tutar reddedilir', () => {
  for (const v of [0, -5, 12.5, MAX_AMOUNT + 1, '100', null]) assert.throws(() => assertAmount(v), (e) => e.status === 400, String(v));
  assert.doesNotThrow(() => assertAmount(1));
  assert.doesNotThrow(() => assertAmount(MAX_AMOUNT));
});

test('ödeme kuralları: geçerli ödeme kabul, kısmi ödeme de kabul', () => {
  assert.doesNotThrow(() => validateSettlement(bal, 'veli', 'ali', 3000));
  assert.doesNotThrow(() => validateSettlement(bal, 'veli', 'ali', 1));
});

test('ödeme kuralları: ihlaller 400 döner', () => {
  fails(() => validateSettlement(bal, 'veli', 'veli', 100), 400, /Kendine/);
  fails(() => validateSettlement(bal, 'veli', 'yabanci', 100), 400, /üyeleri/);
  fails(() => validateSettlement(bal, 'ali', 'veli', 100), 400, /borcun yok/); // alacaklı ödeme kaydedemez
  fails(() => validateSettlement(bal, 'veli', 'can', 100), 400, /alacağı yok/); // borçluya ödeme yapılamaz
  fails(() => validateSettlement(bal, 'veli', 'ali', 3001), 400, /aşıyor/); // borçtan fazla
  fails(() => validateSettlement({ ali: 1000, veli: -9000, x: 8000 }, 'veli', 'ali', 2000), 400, /aşıyor/); // alacaktan fazla
  fails(() => validateSettlement(bal, 'veli', 'ali', 0), 400, /sıfırdan/);
});

test('ödeme kuralı uygulanınca netleştirme tutarlı kalır: önerilen ödemeler hep geçerlidir', () => {
  let b = { a: 7000, b: -2500, c: -4500, d: 0 };
  for (const t of minimizeTransfers(b)) {
    assert.doesNotThrow(() => validateSettlement(b, t.from, t.to, t.amount));
    b = { ...b, [t.from]: b[t.from] + t.amount, [t.to]: b[t.to] - t.amount };
  }
  assert.deepEqual(Object.values(b), [0, 0, 0, 0]);
});

const group = { owner_id: 'ali' };
test('üye çıkarma: bakiyesi sıfır olan kendi isteğiyle ayrılabilir', () => {
  assert.doesNotThrow(() => validateMemberRemoval({ group, actorId: 'can', targetId: 'can', balances: { ali: 0, can: 0 }, memberCount: 2 }));
});

test('üye çıkarma: ihlaller', () => {
  const base = { group, balances: { ali: 0, veli: -100, can: 0 }, memberCount: 3 };
  fails(() => validateMemberRemoval({ ...base, actorId: 'veli', targetId: 'veli' }), 400, /Bakiyesi sıfır olmayan/);
  fails(() => validateMemberRemoval({ ...base, actorId: 'can', targetId: 'veli' }), 403, /sadece grup sahibi/);
  fails(() => validateMemberRemoval({ ...base, actorId: 'ali', targetId: 'ali' }), 400, /Grup sahibi/);
  fails(() => validateMemberRemoval({ ...base, actorId: 'ali', targetId: 'yok' }), 404, /bulunamadı/);
  // sahip, tek başınaysa ayrılabilir; sahip başkasını bakiyesi sıfırsa çıkarabilir
  assert.doesNotThrow(() => validateMemberRemoval({ group, actorId: 'ali', targetId: 'ali', balances: { ali: 0 }, memberCount: 1 }));
  assert.doesNotThrow(() => validateMemberRemoval({ ...base, actorId: 'ali', targetId: 'can' }));
});

test('grup silme: yalnızca sahip', () => {
  assert.doesNotThrow(() => assertOwner(group, 'ali'));
  fails(() => assertOwner(group, 'veli'), 403, /sadece grup sahibi/);
});

test('modüller arası tutarlılık: dört bölüşüm tipi de toplamı korur ve bakiyeler sıfıra toplanır', () => {
  const users = ['a', 'b', 'c'];
  const mk = (paid_by, amount, splits) => ({ paid_by, amount, splits });
  const items = splitItems([{ price: 999, to: 'all' }, { price: 501, to: ['b'] }], users);
  const expenses = [
    mk('a', 10001, splitEqual(10001, users)),
    mk('b', 5000, splitPercent(5000, { a: 50, b: 30, c: 20 })),
    mk('c', 3000, splitExact(3000, { a: 1000, b: 500, c: 1500 })),
    mk('a', items.total, items.shares),
  ];
  for (const e of expenses) assert.equal(Object.values(e.splits).reduce((x, y) => x + y, 0), e.amount);
  const b = computeBalances(users, expenses, []);
  assert.equal(Object.values(b).reduce((x, y) => x + y, 0), 0);
});
