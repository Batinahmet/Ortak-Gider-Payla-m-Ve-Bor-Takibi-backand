# Ücretsiz yayınlama

Arayüz GitHub Pages'te, API Render'ın ücretsiz planında çalışır. İkisi de kredi kartı istemez.

## 1. API (Render)
1. render.com'a GitHub ile giriş yap, **New > Blueprint** de ve backend deposunu seç (`render.yaml` otomatik okunur).
2. `CORS_ORIGIN` değerini frontend adresin yap, yol olmadan: `https://batinahmet.github.io`
3. İstersen `ANTHROPIC_API_KEY` ekle (sadece fiş okuma ve yapay zeka özeti için).
4. Yayınlanınca adresin `https://ortak-gider-api.onrender.com` gibi olur. `/api/health` açılıyorsa hazırdır.

## 2. Arayüz (GitHub Pages)
1. Frontend deposunda `config.js` içindeki `API_URL` değerini `https://<render-adresin>/api` yap, commit'le ve gönder.
2. Depoda **Settings > Pages > Deploy from a branch > main / (root)** seç.
3. Adres: `https://batinahmet.github.io/Ortak-Gider-Payla-m-Ve-Bor-Takibi-Frontand/`

## Ücretsiz planın sınırları
- **Veri kalıcı değil:** Render ücretsiz planında disk geçicidir; servis yeniden başlayınca SQLite veritabanı sıfırlanır, kullanıcılar yeniden kayıt olur. Sunum için yeterli, gerçek kullanım için kalıcı disk veya barındırılan veritabanı gerekir.
- **Uyku:** 15 dakika kullanılmazsa servis uyur, ilk istek yaklaşık 30-60 saniye sürer.
- **HTTPS** ikisinde de hazır gelir; belirteç `localStorage`'da olduğu için güvenlik notundaki sınırlar geçerlidir.
