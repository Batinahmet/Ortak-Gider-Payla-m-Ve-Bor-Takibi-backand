import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distribute, splitEqual, splitPercent, splitExact, splitItems, computeBalances, minimizeTransfers,
} from '../src/split.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('eşit bölüşümde toplam kuruşu kaybetmez', () => {
  const s = splitEqual(1000, ['a', 'b', 'c']);
  assert.equal(sum(s), 1000);
  assert.deepEqual(Object.values(s).sort(), [333, 333, 334]);
});

test('yüzde bölüşümü toplamı korur', () => {
  const s = splitPercent(1001, { a: 50, b: 30, c: 20 });
  assert.equal(sum(s), 1001);
  assert.throws(() => splitPercent(1000, { a: 50, b: 40 }));
  assert.throws(() => splitPercent(1000, { a: '50', b: '50' }));
});

test('tam tutar bölüşümü toplam tutmazsa hata verir', () => {
  assert.deepEqual(splitExact(500, { a: 200, b: 300 }), { a: 200, b: 300 });
  assert.throws(() => splitExact(500, { a: 200, b: 200 }));
});

test('kalem bazlı bölüşüm: ortak ve kişisel kalemler', () => {
  const { total, shares } = splitItems(
    [{ price: 1000, to: 'all' }, { price: 500, to: ['a'] }],
    ['a', 'b'],
  );
  assert.equal(total, 1500);
  assert.deepEqual(shares, { a: 1000, b: 500 });
});

test('distribute geçersiz girdiyi reddeder', () => {
  assert.throws(() => distribute(10.5, [1, 1]));
  assert.throws(() => distribute(10, []));
});

test('bakiyeler toplamı sıfırdır ve netleştirme borçları kapatır', () => {
  const expenses = [
    { paid_by: 'a', amount: 3000, splits: splitEqual(3000, ['a', 'b', 'c']) },
    { paid_by: 'b', amount: 900, splits: splitEqual(900, ['a', 'b', 'c']) },
  ];
  const bal = computeBalances(['a', 'b', 'c'], expenses);
  assert.equal(sum(bal), 0);
  const transfers = minimizeTransfers(bal);
  const after = computeBalances(['a', 'b', 'c'], expenses, transfers.map((t) => ({ from_user: t.from, to_user: t.to, amount: t.amount })));
  assert.deepEqual(Object.values(after), [0, 0, 0]);
  assert.ok(transfers.length <= 2);
});
