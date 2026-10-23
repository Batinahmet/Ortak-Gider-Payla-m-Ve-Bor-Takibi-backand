// Sentetik (uydurma) örnek veri. Gerçek kişisel veri İÇERMEZ (KVKK): adlar kurgusaldır,
// e-postalar RFC 2606 ile ayrılmış example.com alan adındadır.
//
// Kullanım (backend klasöründe):
//   npm run seed         veritabanı boşsa doldurur
//   npm run seed:reset   mevcut tüm veriyi silip yeniden doldurur
//   npm run seed:dump    bellekte doldurur ve db/ornek-veri.sql dosyasına SQL dökümü yazar
//
// Tüm örnek hesapların şifresi: demo12345
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const dumpArg = args.find((a) => a.startsWith('--dump='));
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// Döküm modu asla gerçek veritabanına dokunmaz: her zaman bellekte çalışır.
if (isMain && dumpArg) process.env.DB_PATH = ':memory:';

const { db, tx } = await import('../src/db.js');
const data = await import('../src/data/index.js');
const { hashPassword } = await import('../src/auth.js');
const { splitEqual, splitPercent, splitExact, splitItems } = await import('../src/split.js');

export const DEMO_PASSWORD = 'demo12345';
export const TABLES = ['users', 'sessions', 'groups', 'members', 'expenses', 'expense_splits', 'settlements', 'rules', 'activities'];

const USERS = [
  { id: 'u_ayse', name: 'Ayşe Örnek', email: 'ayse@example.com' },
  { id: 'u_mehmet', name: 'Mehmet Deneme', email: 'mehmet@example.com' },
  { id: 'u_zeynep', name: 'Zeynep Test', email: 'zeynep@example.com' },
  { id: 'u_can', name: 'Can Sentetik', email: 'can@example.com' },
];
// Yönetici hesabı hiçbir gruba üye değildir; sadece rol tabanlı erişimi (/api/admin/*) göstermek içindir.
const ADMIN = { id: 'u_admin', name: 'Yönetici Örnek', email: 'admin@example.com' };
const nameOf = (id) => USERS.find((u) => u.id === id).name;
const tl = (k) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

function clearAll() {
  tx(() => {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'activities'");
  });
}

/** Örnek veriyi ekler ve özet sayıları döndürür. Veritabanı doluysa reset olmadan hata verir. */
export async function seed({ reset = false } = {}) {
  if (data.countUsers() > 0) {
    if (!reset) throw new Error('Veritabanı boş değil. Silip yeniden doldurmak için: npm run seed:reset');
    clearAll();
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const DAY = 86_400_000;
  const now = Date.now();
  const ago = (days) => now - days * DAY;

  const addExpense = (groupId, e, shares, extra = {}) => {
    data.insertExpense({ groupId, createdBy: e.paidBy, splitType: 'equal', createdAt: ago(e.daysAgo), ...e, ...extra }, shares);
    data.logActivity(groupId, e.paidBy, `${nameOf(e.paidBy)}, "${e.title}" harcamasını ekledi (${tl(e.amount)})`, ago(e.daysAgo));
  };

  tx(() => {
    for (const u of USERS) data.createUser({ ...u, passwordHash, createdAt: ago(40) });
    data.createUser({ ...ADMIN, passwordHash, role: 'admin', createdAt: ago(41) });

    // ----- Grup 1: Ev arkadaşları (4 kişi) -----
    const ev = 'g_ev';
    const evMembers = USERS.map((u) => u.id);
    data.createGroup({ id: ev, name: 'Ev Arkadaşları', ownerId: 'u_ayse', inviteCode: 'EVGRUBU2', createdAt: ago(35) });
    evMembers.forEach((u, i) => data.addMember(ev, u, ago(35 - i)));

    // 1) Eşit bölüşüm
    addExpense(ev, { id: 'e_market', title: 'Market alışverişi', amount: 124850, paidBy: 'u_ayse', daysAgo: 20 }, splitEqual(124850, evMembers));
    addExpense(ev, { id: 'e_elektrik', title: 'Elektrik faturası', amount: 86000, paidBy: 'u_mehmet', daysAgo: 15 }, splitEqual(86000, evMembers));
    // 2) Yüzdeyle bölüşüm (Can interneti daha çok kullanıyor)
    addExpense(ev, { id: 'e_internet', title: 'İnternet faturası', amount: 45000, paidBy: 'u_zeynep', daysAgo: 12, splitType: 'percent' },
      splitPercent(45000, { u_ayse: 20, u_mehmet: 20, u_zeynep: 20, u_can: 40 }));
    // 3) Tutarla bölüşüm
    addExpense(ev, { id: 'e_temizlik', title: 'Temizlik malzemeleri', amount: 32000, paidBy: 'u_can', daysAgo: 8, splitType: 'exact' },
      splitExact(32000, { u_ayse: 10000, u_mehmet: 7000, u_zeynep: 8000, u_can: 7000 }));
    // 4) Kalem bazlı bölüşüm (fiş): şampuan sadece Zeynep'in
    const fis = [
      { name: 'Süt', price: 4500, to: 'all' },
      { name: 'Ekmek', price: 1500, to: 'all' },
      { name: 'Şampuan', price: 8900, to: ['u_zeynep'] },
      { name: 'Peynir', price: 12000, to: 'all' },
    ];
    const { total, shares } = splitItems(fis, evMembers);
    addExpense(ev, { id: 'e_fis', title: 'Market fişi', amount: total, paidBy: 'u_ayse', daysAgo: 3, splitType: 'items', items: fis }, shares);

    data.insertSettlement({ id: 's_ev1', groupId: ev, fromUser: 'u_zeynep', toUser: 'u_ayse', amount: 25000, createdAt: ago(2) });
    data.logActivity(ev, 'u_zeynep', `${nameOf('u_zeynep')}, ${nameOf('u_ayse')} kişisine ${tl(25000)} ödedi`, ago(2));

    // Öğrenilmiş kurallar (yapay zeka önerisini düzeltir)
    data.upsertRule(ev, 'süt', 'ortak');
    data.upsertRule(ev, 'şampuan', 'kisisel');
    data.upsertRule(ev, 'sigara', 'kisisel');

    // ----- Grup 2: Tatil grubu (3 kişi) -----
    const tatil = 'g_tatil';
    const tatilMembers = ['u_mehmet', 'u_can', 'u_zeynep'];
    data.createGroup({ id: tatil, name: 'Tatil Grubu', ownerId: 'u_mehmet', inviteCode: 'TATILGRP', createdAt: ago(25) });
    tatilMembers.forEach((u, i) => data.addMember(tatil, u, ago(25 - i)));
    addExpense(tatil, { id: 'e_otel', title: 'Otel', amount: 480000, paidBy: 'u_mehmet', daysAgo: 10 }, splitEqual(480000, tatilMembers));
    // 135075 kuruş 3'e tam bölünmez: artan kuruş en büyük kalan yöntemiyle dağıtılır
    addExpense(tatil, { id: 'e_yemek', title: 'Akşam yemeği', amount: 135075, paidBy: 'u_can', daysAgo: 9 }, splitEqual(135075, tatilMembers));
    data.insertSettlement({ id: 's_tatil1', groupId: tatil, fromUser: 'u_can', toUser: 'u_mehmet', amount: 50000, createdAt: ago(5) });
    data.logActivity(tatil, 'u_can', `${nameOf('u_can')}, ${nameOf('u_mehmet')} kişisine ${tl(50000)} ödedi`, ago(5));
  });

  return Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
}

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

/** Mevcut veritabanı içeriğini INSERT ifadeleri olarak döndürür. Önce migration çalıştırılmış olmalıdır. */
export function dumpSql() {
  const out = [
    '-- Ortak Gider: sentetik örnek veri dökümü (gerçek kişisel veri yoktur, KVKK uyumlu).',
    '-- Önce db/migrations/ altındaki tüm dosyalar sırayla (001, 002, ...), sonra bu dosya çalıştırılır.',
    `-- Örnek hesapların şifresi: ${DEMO_PASSWORD}`,
    'PRAGMA foreign_keys = ON;',
    'BEGIN;',
  ];
  for (const t of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    for (const r of rows) out.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => q(r[c])).join(', ')});`);
  }
  out.push('COMMIT;');
  return `${out.join('\n')}\n`;
}

if (isMain) {
  try {
    const counts = await seed({ reset: args.includes('--reset') || Boolean(dumpArg) });
    console.log('Örnek veri eklendi:', JSON.stringify(counts));
    if (dumpArg) {
      const file = dumpArg.slice('--dump='.length);
      writeFileSync(file, dumpSql());
      console.log('SQL dökümü yazıldı:', file);
    } else {
      console.log(`Giriş için: ayse@example.com (kullanıcı) veya admin@example.com (yönetici) / ${DEMO_PASSWORD}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
