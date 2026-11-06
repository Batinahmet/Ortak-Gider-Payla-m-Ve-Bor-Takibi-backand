# Hafta 7: Bölüşüm ve Borç Netleştirme

## Ne yapar?
Bir harcamayı seçilen kurala göre kişilere paylaştırır, herkesin net bakiyesini hesaplar ve borçları en az sayıda ödemeyle kapatacak öneriyi çıkarır.

## Dosyalar
| Dosya | Görev |
| --- | --- |
| `src/split.js` | Çekirdek algoritmalar: `distribute`, `splitEqual/Percent/Exact/Items`, `computeBalances`, `minimizeTransfers` |
| `src/business-rules.js` | İş kuralları ve doğrulama (Express'ten bağımsız) |
| `src/data/expenses.js`, `settlements.js`, `groups.js` | Modülün verisi (SQL burada) |
| `src/app.js` | Uçlar; algoritma ve kuralları çağırır |
| `test/split.test.js`, `test/rules.test.js`, `test/api.test.js` | Birim ve uçtan uca testler |

## Algoritmalar
- **Bölüşüm:** Para kuruş (tam sayı) olarak tutulur. `distribute` en büyük kalan yöntemiyle paylaştırır; 100,01 ₺ üç kişiye bölünürse 33,34 + 33,34 + 33,33 olur, toplam her zaman tutara eşittir. Dört tip: eşit, yüzde, tutar, kalem bazlı (fiş).
- **Borç hesabı:** Bakiye = ödedikleri − payları, ödeme kayıtları eklenir. Pozitif alacaklı, negatif borçlu. Bakiyelerin toplamı her zaman 0'dır.
- **Netleştirme:** Açgözlü yöntem. En çok borçlu ile en çok alacaklı eşleştirilir, biri sıfırlanınca sıradakine geçilir. N kişide en fazla N−1 ödeme çıkar. Her adımda en az bir kişi kapandığı için algoritma biter.

## Veri modeli
`expenses` (harcama) 1-N `expense_splits` (kişi başı pay, bileşik anahtar: harcama + kullanıcı). `settlements` (ödeme kaydı: kim, kime, ne kadar) gruba bağlıdır. Bakiye tabloda tutulmaz, her seferinde bu kayıtlardan hesaplanır; böylece silinen harcama ile bakiye arasında tutarsızlık oluşmaz.

## İş kuralları ve doğrulama
| Kural | Neden | Cevap |
| --- | --- | --- |
| 0 < tutar ≤ 1.000.000 ₺, tam sayı kuruş | Yazım hatasını (fazladan sıfır) ve kayan nokta hatasını önler | 400 |
| Ödeyen ve katılımcılar grup üyesi olmalı | Başka grubun kullanıcısı bakiyeye karışmasın | 400 |
| Yüzdelerin toplamı 100, tutarların toplamı harcamaya eşit | Paylar toplamı tutmazsa para kaybolur | 400 |
| Kalem sayısı ≤ 100, her kalemin katılımcısı üye | Kötüye kullanımı ve hatayı önler | 400 |
| Ödeme: kendine yapılamaz | Anlamsız kayıt | 400 |
| Ödeme: ödeyen borçlu, alıcı alacaklı olmalı | Borcu olmayan kişi ödeme kaydedip hesabı bozamaz | 400 |
| Ödeme: tutar borcu ve alacağı aşamaz | Fazla ödeme yeni borç yaratır | 400 |
| Harcamayı sadece ekleyen veya grup sahibi siler | Erişim/sahiplik kontrolü | 403 |
| Üyeyi sadece grup sahibi çıkarır; kişi kendi ayrılabilir | Sahiplik kontrolü | 403 |
| Bakiyesi sıfır olmayan üye ayrılamaz/çıkarılamaz | Kalan üyelerin hesabı tutmaz | 400 |
| Sahip, başka üyeler varken ayrılamaz | Sahipsiz grup kalmasın | 400 |
| Grubu sadece sahip siler (kayıtlar `CASCADE` ile silinir) | İlişkili kayıtlar yetim kalmaz | 403 |

Kurallar sunucuda uygulanır, arayüz yalnızca mesajı gösterir.

## Önceki modüllerle entegrasyon
- **Kimlik doğrulama:** tüm uçlar `requireAuth`, grup uçları ayrıca üyelik ister (üye değilse 404).
- **Grup/üye yönetimi:** üye listesi bakiye hesabının evrenidir; ayrılan üyenin sıfır bakiyeli eski kayıtları çıktıdan süzülür.
- **Harcama girişi:** tüm girişler aynı `split.js` fonksiyonlarından geçer.
- **Yapay zeka:** fiş okuma sadece kalemleri ve öneriyi üretir, tutarları algoritma hesaplar. Borç özeti, `minimizeTransfers` çıktısını anlatır.
- **Bildirim/geçmiş:** harcama, ödeme, ayrılma ve çıkarma işlemleri etkinlik akışına yazılır.
- **Veri katmanı:** çok adımlı işlemler `tx()` ile tek transaction'dadır.

## Uçlar
`POST /groups/:id/expenses`, `DELETE /groups/:id/expenses/:eid`, `GET /groups/:id/balances`, `POST /groups/:id/settlements`, `DELETE /groups/:id/members/:uid` (`me` yazılırsa kişi kendi ayrılır), `DELETE /groups/:id`.
