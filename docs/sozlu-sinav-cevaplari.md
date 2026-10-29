# Sözlü Sınav Hazırlık Notları

Proje: Ortak Gider Paylaşımı ve Borç Takibi. Cevaplar bu depodaki koda göre yazıldı.

## Hafta 3: Mimari ve ER

**1. Katmanlı mimariyi neden tercih ettin?**
Her katmanın tek bir işi var: arayüz (frontend), API (`src/app.js`), iş mantığı (`src/split.js`, `src/auth.js`), veri erişimi (`src/data/`), veritabanı (`db/`). Böylece bölüşüm algoritmasını Express'siz test edebiliyorum, veritabanını değiştirirsem sadece veri katmanı etkileniyor, frontend ve backend ayrı depolarda ayrı geliştiriliyor.

**2. İlişki türlerini örnekle açıkla.**
- 1-N: bir grubun çok harcaması var (`groups` → `expenses`), bir harcamanın çok payı var (`expenses` → `expense_splits`).
- N-N: kullanıcılar ve gruplar. Bir kullanıcı çok gruba, bir grup çok kullanıcıya üye olabilir. Bu, ara tablo `members` ile iki adet 1-N'e çevrilir.
- 1-1: projede zorunlu 1-1 yok. Örnek olarak kullanıcı ve profil ayrı tabloya alınsaydı 1-1 olurdu, gerek duymadım.

**3. Hangi varlıklar birincil anahtar taşır, neden?**
Hepsi taşır; satırı tekil tanımlamak ve yabancı anahtarlarla bağlanmak için. `users`, `groups`, `expenses`, `settlements` tek sütunlu metin kimliği kullanır. `members` (grup + kullanıcı), `expense_splits` (harcama + kullanıcı) ve `rules` (grup + anahtar kelime) bileşik anahtar kullanır, çünkü aynı çift iki kez olmamalı.

**4. Klasör yapısını hangi mantıkla kurdun?**
`src/` kod, `src/data/` veri erişimi, `db/migrations/` şema, `db/seed.js` örnek veri, `test/` testler, `docs/` diyagram ve notlar. Sorumluluğa göre ayrım; bir şeyi nerede arayacağım belli.

**5. `.gitignore` neden gerekli, neler eklenmemeli?**
Gizli ve üretilebilir dosyaları depodan uzak tutar. Eklenmemesi gerekenler: `.env` (API anahtarı, şifreler), `node_modules/`, gerçek veritabanı dosyası (`/data/`), log ve işletim sistemi dosyaları. `.env.example` ise örnek olarak depoda durur.

## Hafta 4: Veritabanı tasarımı ve veri erişim katmanı

**1. Bir tabloya neden indeks eklediğin/eklemedin?**
İndeks, bir sütuna göre aramayı hızlandırır; kitabın sonundaki dizin gibi. Bedeli: yazmada ek iş ve ek yer. Bu yüzden sadece sık sorgulanan yerlere ekledim: `expenses (group_id, created_at)` (bir grubun harcamaları tarihe göre listelenir) ve `activities (group_id, id)` (etkinlik akışı). `users.email` ve `groups.invite_code` zaten `UNIQUE` olduğu için SQLite kendiliğinden indeks kurar, giriş ve davet kodu aramaları hızlıdır. `members`, `expense_splits` ve `rules` bileşik birincil anahtarı zaten indeks işi görür. `settlements` ve `rules` gibi küçük tablolara eklemedim; veri azken indeks fayda sağlamaz, sadece yazmayı yavaşlatır.

**2. Yabancı anahtar kısıtı ne işe yarar?**
Referans bütünlüğünü korur: olmayan bir gruba harcama veya olmayan bir kullanıcıya pay yazılamaz. `ON DELETE CASCADE` ile grup silinince üyelik, harcama, ödeme ve etkinlikleri de silinir; sahipsiz kayıt kalmaz. SQLite'ta varsayılan kapalı olduğu için her bağlantıda `PRAGMA foreign_keys = ON` açıyorum. Testte `PRAGMA foreign_key_check` boş dönüyor.

**3. N-N ilişkiyi nasıl modelledin?**
Ara tabloyla. Kullanıcı ve grup arasında `members (group_id, user_id)` var; birincil anahtar çifttir, bu yüzden aynı kişi aynı gruba iki kez giremez. Harcama ve kullanıcı arasında da `expense_splits (expense_id, user_id, share)` aynı mantıkla çalışır ve ek olarak ilişkiye ait veriyi (payı) taşır.

**4. Migration neden kullanılır?**
Şemayı sürümlü ve tekrarlanabilir biçimde değiştirmek için. Şema elle değil `db/migrations/001_...sql`, `002_...sql` dosyalarıyla kurulur; `PRAGMA user_version` hangisinin uygulandığını tutar, her dosya bir kez çalışır. Böylece herkesin veritabanı aynı şemaya sahip olur, değişiklik Git'te izlenir. Hafta 5'te mevcut dosyayı düzenlemek yerine 002 ekledim.

**5. Bir CRUD işleminin SQL'ini açıkla.**
Hepsi parametreli sorgudur (SQL enjeksiyonunu önler):
- Create: `INSERT INTO groups (id, name, owner_id, invite_code, created_at) VALUES (?,?,?,?,?)`
- Read: `SELECT * FROM groups WHERE id = ?`
- Update: `UPDATE users SET name = ? WHERE id = ?`
- Delete: `DELETE FROM expenses WHERE id = ?` (payları cascade ile silinir).
Harcama eklemek gibi çok adımlı işlemler `tx()` ile tek transaction'da yapılır: harcama ve payları ya birlikte yazılır ya hiç.

## Hafta 5: Kullanıcı yönetimi ve kimlik doğrulama

**1. Parolayı neden hash'liyoruz, tuz (salt) nedir?**
Veritabanı sızsa bile parolalar okunamasın diye. Hash tek yönlüdür, parola geri çıkarılamaz; giriş yaparken girilen parola aynı şekilde hash'lenip karşılaştırılır. Tuz, her parolaya eklenen rastgele değerdir (bende 16 bayt). Aynı parolayı kullanan iki kişinin hash'i farklı çıkar ve hazır hash tabloları (rainbow table) işe yaramaz. Algoritma `scrypt`: yavaş ve bellek isteyen, bu yüzden deneme pahalıdır. Karşılaştırma `timingSafeEqual` ile yapılır.

**2. Oturum ve token farkı nedir?**
Oturum (session), durumun sunucuda tutulduğu yaklaşımdır: istemci sadece bir kimlik taşır, sunucu kim olduğunu tablodan bulur. Token yaklaşımında (JWT gibi) bilgi belirtecin içindedir ve sunucu imzayı doğrular, durum tutmaz. Benim projem karışık: istemciye rastgele opak bir belirteç veriyorum, sunucuda `sessions` tablosunda yalnızca SHA-256 özetini tutuyorum. Böylece oturumu anında iptal edebiliyorum (çıkış, şifre değişimi, süre dolması), JWT'de bu zordur. Bedeli her istekte bir veritabanı sorgusu; tek sunucuda önemsiz.

**3. Rol tabanlı erişimi nasıl uyguladın?**
`users.role` sütunu (`user` veya `admin`, `CHECK` kısıtlı). `requireAuth` giriş yoksa 401 verir; `requireRole('admin')` rol uymuyorsa 403 verir. Rol belirteçte değil, her istekte veritabanından okunur, bu yüzden rol değişince hemen geçerli olur. Kayıt isteğine `role: "admin"` yazılsa da yok sayılır (mass assignment koruması). Ayrıca grup içinde sahip/üye kontrolü var. Yönetici uçları: `/api/admin/users`.

**4. Başarısız giriş denemesinde ne oluyor?**
Her zaman aynı genel mesaj döner: "E-posta veya şifre hatalı"; hangisinin yanlış olduğu belli olmaz. Sayaç (`failed_attempts`) artar, 5 hatada hesap 15 dakika kilitlenir (`locked_until`), kilitliyken doğru parola da kabul edilmez, başarılı girişte sayaç sıfırlanır. Ek olarak IP başına hız sınırı vardır ve olmayan e-postada da sahte hash hesaplanır, böylece yanıt süresinden hesabın varlığı anlaşılmaz. Dezavantaj: biri başkasının hesabını kısa süre kilitleyebilir; hesabın ele geçirilmesinden daha hafif bir risk olduğu için bunu kabul ettim.

**5. Yetkisiz kullanıcı korumalı sayfaya girerse ne olur?**
Giriş yapmamışsa belirteç olmadığı için sunucu 401 döner ve arayüz giriş ekranını açar. Giriş yapmış ama yetkisiz (normal kullanıcı) `#/admin` adresini elle açarsa istek yine sunucuya gider, sunucu 403 "Bu işlem için yetkin yok" döner ve ekranda yalnızca bu hata görünür, hiçbir yönetici verisi gönderilmez. Menüde "Yönetim" bağlantısını sadece yöneticiye göstermem kolaylık içindir; asıl koruma sunucudadır. Testi var: aynı uç yetkisizde 403, yöneticide 200.
