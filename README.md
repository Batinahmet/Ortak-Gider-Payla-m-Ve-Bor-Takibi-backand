# Ortak Gider – Backend

Ev arkadaşları ve gruplar için ortak gider paylaşımı ve borç takibi API'si. Node.js + Express + SQLite.
Arayüz ayrı depodadır: **Ortak-Gider-Payla-m-Ve-Bor-Takibi-Frontand**.

## Özellikler

| Modül | Nerede |
| --- | --- |
| Kayıt / giriş, grup ve davet kodu | `src/app.js`, `src/auth.js` |
| Harcama girişi | `POST /api/groups/:id/expenses` |
| Bölüşüm (eşit, yüzde, tutar, kalem bazlı) | `src/split.js` |
| Borç netleştirme (en az ödemeyle kapatma) | `src/split.js` → `minimizeTransfers` |
| Ödeme kaydı, geçmiş, etkinlik akışı | `/settlements`, `/expenses`, `/activity` |
| Yapay zeka: fiş okuma, öğrenen kurallar, borç özeti | `src/ai.js` |
| Veri erişim katmanı (tüm SQL burada) | `src/data/` |
| Şema (migration), örnek veri | `db/` |

Tüm tutarlar **kuruş (tam sayı)** olarak saklanır. Para hesabını algoritma yapar; yapay zeka sadece fişi okur ve sonucu anlatır.

## Kurulum

Gereksinim: Node.js 22.13+

```bash
npm install
cp .env.example .env    # değerleri doldur; .env Git'e eklenmez
npm run dev             # http://localhost:3000
npm test
```

`ANTHROPIC_API_KEY` boşsa fiş okuma ve özet uçları 503 döner, geri kalanı çalışır.
`CORS_ORIGIN` frontend'in adresiyle aynı olmalıdır.

## Veritabanı ve veri erişim katmanı

```
db/migrations/001_baslangic.sql   şema (DDL): tablolar, ilişkiler, kısıtlar, indeksler
db/migrations/002_roller_ve_giris_kilidi.sql   kullanıcı rolü ve giriş kilidi sütunları
db/seed.js                        sentetik örnek veri scripti
db/ornek-veri.sql                 aynı örnek verinin SQL dökümü
src/db.js                         bağlantı, transaction ve migration çalıştırıcı
src/data/*.js                     veri erişim katmanı (CRUD)
```

ER diyagramı: [docs/er-diyagrami.md](docs/er-diyagrami.md)

**Migration.** `src/db.js` açılışta `db/migrations/NNN_ad.sql` dosyalarını sırayla çalıştırır. Uygulanan son sürümü `PRAGMA user_version` ile saklar, böylece her dosya yalnızca bir kez çalışır. Şemayı değiştirmek için mevcut dosyayı düzenlemek yerine yeni bir dosya eklenir (002 buna örnektir).

**Kısıtlar ve indeksler.**
- Birincil anahtar: her tabloda. `members`, `expense_splits` ve `rules` bileşik anahtar kullanır.
- Yabancı anahtar: `ON DELETE CASCADE` ile grup silinince üyelik, harcama, ödeme, kural ve etkinlikler, harcama silinince payları da silinir. SQLite'ta varsayılan olarak kapalı olduğu için bağlantıda `PRAGMA foreign_keys = ON` açılır.
- `UNIQUE`: `users.email`, `groups.invite_code`.
- `CHECK`: `role IN ('user','admin')`, `failed_attempts >= 0`, `amount > 0`, `share >= 0`, `split_type IN ('equal','percent','exact','items')`, `kind IN ('ortak','kisisel')`.
- İndeks: `idx_expenses_group (group_id, created_at)` ve `idx_activities_group (group_id, id)`, grup bazlı listeleme sorguları için.

**Veri erişim katmanı.** API katmanı (`src/app.js`) SQL yazmaz, `src/data/` içindeki fonksiyonları çağırır. Tüm sorgular parametrelidir (`?`), bu da SQL enjeksiyonunu önler. Harcama ile paylarının birlikte yazılması gibi çok adımlı işlemler `tx()` ile tek transaction içinde yapılır, biri başarısız olursa hepsi geri alınır.

| Dosya | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| `users.js` | `createUser` | `findUserByEmail`, `findUserById`, `listUsersWithStats`, `emailExists` | `updateUserName`, `updateUserPassword`, `setUserRole`, `recordFailedLogin` | `deleteUser` |
| `groups.js` | `createGroup`, `addMember` | `findGroup`, `findGroupByInvite`, `listGroupsOfUser`, `listMembers`, `isMember` | `renameGroup` | `removeMember`, `deleteGroup` |
| `expenses.js` | `insertExpense` | `listExpenses`, `findExpense` | `updateExpenseTitle` | `deleteExpense` |
| `settlements.js` | `insertSettlement` | `listSettlements` | | |
| `rules.js` | `upsertRule` | `listRules` | `upsertRule` | `deleteRule` |
| `activities.js` | `logActivity` | `listActivities` | | |
| `sessions.js` | `createSession` | `findUserBySession` | | `deleteSession`, `deleteSessionsOfUser`, `deleteExpiredSessions` |

**Neden ORM değil, saf SQL?** Şema küçük (9 tablo) ve ilişkileri, kısıtları ve sorguları doğrudan görmek istedim. SQL kendi dosyasında okunabilir, ek bağımlılık gerekmez (SQLite Node.js ile birlikte gelir) ve her sorgunun ne yaptığı açıkça takip edilir. Tablolar çoğaldığında ORM düşünülebilir.

**Örnek veri.** Tamamen uydurmadır: kurgusal adlar, e-postalar `example.com` alan adında, gerçek kişisel veri yoktur (KVKK). 4 kullanıcı ve 1 yönetici (`admin@example.com`), 2 grup, 7 harcama (eşit, yüzde, tutar ve kalem bazlı dört bölüşüm tipinin hepsi), 2 ödeme kaydı, 3 öğrenilmiş kural.

```bash
npm run seed         # veritabanı boşsa doldurur
npm run seed:reset   # mevcut veriyi silip yeniden doldurur
npm run seed:dump    # bellekte doldurur, db/ornek-veri.sql dosyasını yeniden üretir
```

Tüm örnek hesapların şifresi `demo12345`, örneğin `ayse@example.com`. SQL dökümünü başka bir araçta yüklemek için önce `db/migrations/` altındaki dosyalar sırayla, sonra `db/ornek-veri.sql` çalıştırılır.

## Kimlik doğrulama ve yetkilendirme (Hafta 5)

Kısa güvenlik gerekçeleri: [docs/guvenlik-notu.md](docs/guvenlik-notu.md)

- **Kayıt / giriş:** `scrypt` + kullanıcıya özel rastgele tuz. Şifre 8-128 karakter.
- **Oturum:** sunucuda tutulan rastgele belirteç (`Authorization: Bearer ...`). Veritabanında yalnızca SHA-256 özeti durur, süre `SESSION_DAYS` (varsayılan 7 gün) ile ayarlanır. Süresi dolan oturumlar açılışta ve saatte bir silinir.
- **Kaba kuvvet koruması:** IP başına hız sınırı (`AUTH_RATE_LIMIT`, varsayılan dakikada 10), 5 hatalı girişte hesap 15 dakika kilitlenir, hata mesajı genel tutulur ("E-posta veya şifre hatalı").
- **Roller:** `users.role` = `user` veya `admin`. Rol her istekte veritabanından okunur, kayıt isteğinden asla alınmaz. `requireRole('admin')` yetkisiz kullanıcıya 403 döner. Grup içinde ayrıca sahip/üye ayrımı vardır.
- **Şifre değiştirme:** mevcut şifre doğrulanır, diğer tüm oturumlar kapatılır.

İlk yöneticiyi atamak: `npm run admin:promote -- kisi@example.com` (geri almak için sonuna `user` eklenir).

## API özeti

`POST /api/auth/register|login|logout`
`GET|PATCH /api/me` (profil, ad değiştirme), `POST /api/me/password`
`GET /api/admin/users`, `PATCH /api/admin/users/:uid/role` (yalnızca `admin`)
`GET|POST /api/groups`, `POST /api/groups/join`, `GET /api/groups/:id`
`GET|POST /api/groups/:id/expenses`, `DELETE /api/groups/:id/expenses/:eid`
`GET /api/groups/:id/balances`, `POST /api/groups/:id/settlements`, `GET /api/groups/:id/activity`
`GET|POST /api/groups/:id/rules`, `POST /api/groups/:id/receipts/scan`, `POST /api/groups/:id/summary`

## Testler

`npm test` ile 41 test çalışır. Bölüşüm, veri katmanı, örnek veri ve kimlik doğrulama testleri Express'e ihtiyaç duymaz. `test/api.test.js` gerçek HTTP katmanını dener ve `npm install` gerektirir.

## Güvenlik

- `.env` dosyaları `.gitignore` ile dışarıda; sadece `.env.example` depoda.
- Şifreler `scrypt` ile özetlenir, oturum belirteçleri veritabanında SHA-256 özeti olarak tutulur.
- Giriş ve yapay zeka uçlarında hız sınırı vardır; grup uçları sadece üyelere açıktır, yönetici uçları sunucuda rol kontrolüyle korunur.
