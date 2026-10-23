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

## Hafta 5: Kimlik doğrulama ve yetkilendirme

Not: Hafta 5 soru listesi ekran görüntüsünden yeniden okunamadı; aşağıdakiler bu haftanın konularındaki tipik sorulardır. Resmî listeyle karşılaştırıp gerekirse eşleştir.

**Kimlik doğrulama (authentication) ile yetkilendirme (authorization) farkı nedir?**
Kimlik doğrulama "sen kimsin"i, yetkilendirme "bunu yapabilir misin"i cevaplar. Projede `requireAuth` ilkini (yoksa 401), `requireRole('admin')` ikincisini (yetki yoksa 403) yapar.

**Şifreyi neden düz metin saklamıyorsun, nasıl saklıyorsun?**
Veritabanı sızarsa tüm şifreler açığa çıkar. Şifre `scrypt` ile özetlenir (yavaş ve bellek isteyen, deneme pahalı), her şifreye 16 baytlık rastgele tuz eklenir; aynı şifre iki kullanıcıda farklı özet verir ve hazır tablo (rainbow table) işe yaramaz. Karşılaştırma `timingSafeEqual` ile yapılır.

**Hash ile şifreleme (encryption) farkı?**
Şifreleme anahtarla geri açılabilir, hash tek yönlüdür. Şifre geri okunmak zorunda olmadığı için hash kullanılır.

**Oturum mu JWT mi, neden oturum?**
Sunucuda tutulan rastgele belirteç seçtim. Veritabanında yalnızca SHA-256 özeti durur, sızarsa kullanılamaz. Çıkışta, şifre değişince ve süre dolunca sunucudan silinerek anında iptal edilir. JWT'de iptal zordur. Bedeli: her istekte veritabanı sorgusu, tek sunucuda önemsiz.

**Brute-force saldırısına karşı ne yaptın?**
IP başına hız sınırı, 5 hatalı girişte 15 dakika hesap kilidi, "E-posta veya şifre hatalı" şeklinde genel mesaj ve olmayan e-postada da sahte hash hesabı (süreden hesap varlığı anlaşılmasın). Kilidin dezavantajı: biri başkasının hesabını geçici kilitleyebilir.

**Rol tabanlı erişim (RBAC) nasıl çalışıyor?**
`users.role` `user` veya `admin`. Rol her istekte veritabanından okunur, token içine gömülmez; rolü değişen kullanıcı hemen etkilenir. Grup içinde ayrıca sahip/üye ayrımı vardır. Kontrol sunucudadır; arayüzde bağlantıyı gizlemek güvenlik değil, sadece kullanım kolaylığıdır.

**Mass assignment nedir, nasıl önledin?**
İstek gövdesindeki alanların körlemesine kayda yazılması. Kayıt isteğine `role: "admin"` eklenirse yok sayılır, rol yalnızca yönetici ucu veya `admin:promote` ile değişir.

**SQL enjeksiyonu ve XSS?**
Tüm sorgular parametreli (`?`). Arayüzde kullanıcı metni `esc()` ile kaçırılarak basılır. Belirteç `localStorage`'da olduğu için XSS riski kalır; daha güçlü çözüm `httpOnly` çerez + CSRF koruması.

**Şifre değiştirmede neye dikkat ettin?**
Önce mevcut şifre doğrulanır (çalınmış oturum şifreyi değiştiremesin), yanlış deneme kilide sayılır, yeni şifre eskisiyle aynı olamaz, başarılı olunca diğer tüm oturumlar kapanır.
