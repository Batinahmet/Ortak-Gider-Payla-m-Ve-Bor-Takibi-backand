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

## Veritabanı

ER diyagramı ve tablo açıklamaları: [docs/er-diyagrami.md](docs/er-diyagrami.md)

## API özeti

`POST /api/auth/register|login|logout`, `GET /api/me`
`GET|POST /api/groups`, `POST /api/groups/join`, `GET /api/groups/:id`
`GET|POST /api/groups/:id/expenses`, `DELETE /api/groups/:id/expenses/:eid`
`GET /api/groups/:id/balances`, `POST /api/groups/:id/settlements`, `GET /api/groups/:id/activity`
`GET|POST /api/groups/:id/rules`, `POST /api/groups/:id/receipts/scan`, `POST /api/groups/:id/summary`

## Güvenlik

- `.env` dosyaları `.gitignore` ile dışarıda; sadece `.env.example` depoda.
- Şifreler `scrypt` ile özetlenir, oturum belirteçleri veritabanında SHA-256 özeti olarak tutulur.
- Giriş ve yapay zeka uçlarında hız sınırı vardır; grup uçları sadece üyelere açıktır.
