// Bölüşüm ve borç netleştirme algoritmaları.
// Tüm tutarlar kuruş (tam sayı) olarak tutulur; kayan nokta hatası oluşmaz.

/** total'ı weights oranında paylaştırır; toplam her zaman tam olarak total'a eşittir (en büyük kalan yöntemi). */
export function distribute(total, weights) {
  if (!Number.isInteger(total) || total < 0) throw new Error('Tutar tam sayı (kuruş) olmalı');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || !(sum > 0)) throw new Error('Geçersiz paylaşım ağırlıkları');
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map(Math.floor);
  const remaining = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - base[i], i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < remaining; k++) base[order[k][1]]++;
  return base;
}

const toMap = (users, shares) => Object.fromEntries(users.map((u, i) => [u, shares[i]]));

export function splitEqual(total, users) {
  if (!users.length) throw new Error('En az bir katılımcı gerekli');
  return toMap(users, distribute(total, users.map(() => 1)));
}

/** percents: { userId: yüzde } — toplamı 100 olmalı. */
export function splitPercent(total, percents) {
  const users = Object.keys(percents);
  if (users.some((u) => typeof percents[u] !== 'number' || !Number.isFinite(percents[u]) || percents[u] < 0)) {
    throw new Error('Yüzdeler sıfır veya pozitif sayı olmalı');
  }
  const sum = users.reduce((a, u) => a + percents[u], 0);
  if (!users.length || Math.abs(sum - 100) > 0.01) throw new Error('Yüzdelerin toplamı 100 olmalı');
  return toMap(users, distribute(total, users.map((u) => percents[u])));
}

/** amounts: { userId: kuruş } — toplamı total'a eşit olmalı. */
export function splitExact(total, amounts) {
  const users = Object.keys(amounts);
  const sum = users.reduce((a, u) => a + amounts[u], 0);
  if (!users.length || users.some((u) => !Number.isInteger(amounts[u]) || amounts[u] < 0)) {
    throw new Error('Tutarlar pozitif tam sayı (kuruş) olmalı');
  }
  if (sum !== total) throw new Error('Girilen tutarların toplamı harcama tutarına eşit olmalı');
  return { ...amounts };
}

/** items: [{ price, to: 'all' | userId | [userId] }] — her kalem kendi katılımcıları arasında eşit bölünür. */
export function splitItems(items, allUsers) {
  const shares = {};
  let total = 0;
  for (const it of items) {
    const users = it.to === 'all' ? allUsers : Array.isArray(it.to) ? it.to : [it.to];
    const part = splitEqual(it.price, users);
    total += it.price;
    for (const [u, s] of Object.entries(part)) shares[u] = (shares[u] || 0) + s;
  }
  return { total, shares };
}

/**
 * Net bakiye: pozitif = alacaklı, negatif = borçlu.
 * expenses: [{ paid_by, amount, splits: { userId: pay } }]
 * settlements: [{ from_user, to_user, amount }]  (from, to'ya ödeme yaptı)
 */
export function computeBalances(memberIds, expenses, settlements = []) {
  const bal = Object.fromEntries(memberIds.map((m) => [m, 0]));
  const add = (u, v) => (bal[u] = (bal[u] || 0) + v);
  for (const e of expenses) {
    add(e.paid_by, e.amount);
    for (const [u, s] of Object.entries(e.splits)) add(u, -s);
  }
  for (const s of settlements) {
    add(s.from_user, s.amount);
    add(s.to_user, -s.amount);
  }
  return bal;
}

/** Açgözlü yöntemle en az sayıda ödemeyle borçları kapatır. */
export function minimizeTransfers(balances) {
  const debtors = [];
  const creditors = [];
  for (const [u, b] of Object.entries(balances)) {
    if (b < 0) debtors.push([u, -b]);
    else if (b > 0) creditors.push([u, b]);
  }
  debtors.sort((a, b) => b[1] - a[1]);
  creditors.sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i][1], creditors[j][1]);
    out.push({ from: debtors[i][0], to: creditors[j][0], amount });
    debtors[i][1] -= amount;
    creditors[j][1] -= amount;
    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }
  return out;
}
