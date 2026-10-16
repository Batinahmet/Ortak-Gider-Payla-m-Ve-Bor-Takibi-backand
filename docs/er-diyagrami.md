# Veritabanı ER Diyagramı

Ortak Gider uygulamasının veri modeli: 9 varlık, 15 ilişki. Şema `src/db.js` içinde kuruludur.

![ER diyagramı](er-diyagrami-tr.png)

İngilizce (kodla birebir aynı adlar): [er-diagram-en.png](er-diagram-en.png)

## İlişkiler

- **1-N:** Bir grubun birçok harcaması, ödeme kaydı ve etkinliği olur. Bir harcama birçok paya bölünür.
- **N-N:** Kullanıcı ve grup arasındaki ilişki `UYELER` ara tablosuyla, harcama ve kullanıcı arasındaki ilişki `HARCAMA_PAYLARI` ara tablosuyla kurulur.
- Tüm tutarlar kuruş (tam sayı) olarak saklanır.

## Diyagram ve kod eşleşmesi

| Diyagram | Kod (`src/db.js`) |
| --- | --- |
| KULLANICILAR | `users` |
| OTURUMLAR | `sessions` |
| GRUPLAR | `groups` |
| UYELER | `members` |
| HARCAMALAR | `expenses` |
| HARCAMA_PAYLARI | `expense_splits` |
| ODEMELER | `settlements` |
| KURALLAR | `rules` |
| ETKINLIKLER | `activities` |

## Mermaid kaynağı

GitHub bu bloğu otomatik çizer. Aynı kaynak [er-diyagrami-tr.mmd](er-diyagrami-tr.mmd) dosyasındadır.

```mermaid
erDiagram
  KULLANICILAR ||--o{ OTURUMLAR : "oturum açar"
  KULLANICILAR ||--o{ GRUPLAR : "sahibidir"
  KULLANICILAR ||--o{ UYELER : "üye olur"
  GRUPLAR ||--o{ UYELER : "üyeleri içerir"
  GRUPLAR ||--o{ HARCAMALAR : "harcamaları içerir"
  KULLANICILAR ||--o{ HARCAMALAR : "öder (odeyen_id)"
  KULLANICILAR ||--o{ HARCAMALAR : "ekler (ekleyen_id)"
  HARCAMALAR ||--o{ HARCAMA_PAYLARI : "paylara bölünür"
  KULLANICILAR ||--o{ HARCAMA_PAYLARI : "pay sahibidir"
  GRUPLAR ||--o{ ODEMELER : "ödeme kayıtlarını içerir"
  KULLANICILAR ||--o{ ODEMELER : "öder (gonderen_id)"
  KULLANICILAR ||--o{ ODEMELER : "alır (alici_id)"
  GRUPLAR ||--o{ KURALLAR : "öğrenilen kurallar"
  GRUPLAR ||--o{ ETKINLIKLER : "etkinlik akışı"
  KULLANICILAR ||--o{ ETKINLIKLER : "yapar (yapan_id)"

  KULLANICILAR {
    metin kullanici_id PK
    metin ad
    metin eposta UK
    metin sifre_ozeti
    tamsayi olusturma_zamani
  }
  OTURUMLAR {
    metin belirtec_ozeti PK
    metin kullanici_id FK
    tamsayi bitis_zamani
  }
  GRUPLAR {
    metin grup_id PK
    metin ad
    metin sahip_id FK
    metin davet_kodu UK
    tamsayi olusturma_zamani
  }
  UYELER {
    metin grup_id PK,FK
    metin kullanici_id PK,FK
    tamsayi katilma_zamani
  }
  HARCAMALAR {
    metin harcama_id PK
    metin grup_id FK
    metin baslik
    tamsayi tutar "kuruş"
    metin odeyen_id FK
    metin ekleyen_id FK
    metin bolusum_tipi
    metin kalemler_json
    tamsayi olusturma_zamani
  }
  HARCAMA_PAYLARI {
    metin harcama_id PK,FK
    metin kullanici_id PK,FK
    tamsayi pay "kuruş"
  }
  ODEMELER {
    metin odeme_id PK
    metin grup_id FK
    metin gonderen_id FK
    metin alici_id FK
    tamsayi tutar "kuruş"
    tamsayi olusturma_zamani
  }
  KURALLAR {
    metin grup_id PK,FK
    metin kalem PK
    metin tur "ortak veya kişisel"
  }
  ETKINLIKLER {
    tamsayi etkinlik_id PK
    metin grup_id FK
    metin yapan_id FK
    metin mesaj
    tamsayi olusturma_zamani
  }
```
