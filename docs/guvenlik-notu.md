# Güvenlik Notu (Hafta 5)

## Şifre saklama: scrypt + tuz
Şifre düz metin saklanmaz. `scrypt` yavaş ve bellek isteyen bir fonksiyondur, bu yüzden çalınan bir veritabanında şifre denemesi pahalıdır. Her şifreye 16 baytlık rastgele tuz eklenir, aynı şifreyi kullanan iki kişinin özeti farklı çıkar. bcrypt de uygun bir seçimdi. scrypt Node.js ile hazır geldiği için ek bağımlılık gerekmedi.

## Oturum: sunucuda tutulan belirteç (JWT değil)
Rastgele 32 baytlık belirteç üretilir, veritabanında yalnızca SHA-256 özeti saklanır; veritabanı sızsa bile belirteçle giriş yapılamaz. Oturum sunucuda durduğu için iptal edilebilir: çıkışta, şifre değişince ve süre dolunca silinir. JWT bu iptali zorlaştırır, proje tek sunucu olduğu için oturum tablosu daha basit ve güvenlidir. Süre `SESSION_DAYS` ile ayarlanır, süresi dolanlar açılışta ve saatte bir temizlenir.

## Kaba kuvvet savunması
1. IP başına hız sınırı (kayıt, giriş, şifre değiştirme).
2. 5 hatalı denemede hesap 15 dakika kilitlenir, kilitliyken doğru şifre de kabul edilmez.
3. Hata mesajı genel: "E-posta veya şifre hatalı". Hesabın var olup olmadığı anlaşılmaz.
4. Kayıtlı olmayan e-postada da sahte bir hash hesaplanır, yanıt süresinden hesap tahmin edilemez.

Kilit, bir saldırganın başkasının hesabını geçici kilitlemesine izin verir. Bu bilinçli bir ödünleşimdir: hesap ele geçirilmesi, kısa süreli kilitten daha ağır bir risktir.

## Yetkilendirme (rol tabanlı erişim)
- Genel rol: `user` ve `admin` (`users.role`). Grup içinde ayrıca sahip ve üye ayrımı vardır.
- Kontrol her zaman sunucuda yapılır; arayüzde bir düğmenin gizlenmesi güvenlik sayılmaz. Rol her istekte veritabanından okunur, oturum açıldıktan sonra rolü değişen kullanıcı hemen etkilenir.
- 401 = giriş yok, 403 = giriş var ama yetki yok.
- Mass assignment: kayıt isteğine `role: "admin"` eklense de yok sayılır. Rol sadece yönetici ucuyla veya `npm run admin:promote` ile değişir. Yönetici kendi rolünü değiştiremez.

## Diğer önlemler
- SQL enjeksiyonu: tüm sorgular parametrelidir.
- Gizli bilgiler (`ANTHROPIC_API_KEY` vb.) `.env` içindedir, Git'e girmez.
- API yanıtlarında şifre özeti ve kilit bilgisi asla yer almaz (`publicUser`).

## Sınırlar ve sonraki adımlar
- Belirteç tarayıcıda `localStorage` içinde tutulur. XSS durumunda okunabilir; bu yüzden arayüz kullanıcı verisini `textContent` ile basar. Daha güçlü çözüm: `httpOnly` çerez + CSRF koruması.
- Yayına alırken HTTPS zorunludur, `CORS_ORIGIN` yalnızca frontend adresine ayarlanmalıdır.
- Yapılmadı: "şifremi unuttum", e-posta doğrulama, iki adımlı doğrulama.
