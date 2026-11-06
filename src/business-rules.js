// İş kuralları ve doğrulama. Express'ten bağımsız saf fonksiyonlardır; test/rules.test.js doğrudan çağırır.
// Her kural ihlalinde HttpError(400/403) fırlatır, mesaj kullanıcıya gösterilebilir.
import { HttpError, bad } from './errors.js';

/** Tek bir harcama veya ödeme için üst sınır: 1.000.000 ₺ (kuruş). Yazım hatalarını (fazladan sıfır) yakalar. */
export const MAX_AMOUNT = 100_000_000;
export const MAX_ITEMS = 100;

export function assertAmount(amount, label = 'Tutar') {
  if (!Number.isInteger(amount) || amount <= 0) throw bad(`${label} sıfırdan büyük olmalı`);
  if (amount > MAX_AMOUNT) throw bad(`${label} en fazla 1.000.000 ₺ olabilir`);
}

/**
 * Ödeme kaydı kuralları:
 *  1. Kendine ödeme yapılamaz.
 *  2. Ödeyen gerçekten borçlu, alıcı gerçekten alacaklı olmalı (borcu olmayan kişi ödeme kaydedemez).
 *  3. Tutar, ödeyenin borcunu ve alıcının alacağını aşamaz (fazla ödeme yeni bir borç yaratır).
 * balances: { userId: kuruş } (negatif = borçlu)
 */
export function validateSettlement(balances, from, to, amount) {
  assertAmount(amount, 'Ödeme tutarı');
  if (from === to) throw bad('Kendine ödeme yapılamaz');
  if (!(from in balances) || !(to in balances)) throw bad('Ödeme yalnızca grup üyeleri arasında yapılabilir');
  if (balances[from] >= 0) throw bad('Bu grupta borcun yok, ödeme kaydedemezsin');
  if (balances[to] <= 0) throw bad('Alıcının bu grupta alacağı yok');
  const max = Math.min(-balances[from], balances[to]);
  if (amount > max) throw bad('Ödeme tutarı borcu veya alacağı aşıyor');
}

/**
 * Gruptan çıkarma/ayrılma kuralları (ilişkili kayıtların tutarlılığı için):
 *  - Çıkarılan veya ayrılan kişinin bakiyesi sıfır olmalı; yoksa kalan üyelerin hesabı tutmaz.
 *  - Grup sahibi, başka üyeler varken ayrılamaz ve çıkarılamaz (sahipsiz grup kalmasın).
 *  - Başkasını yalnızca grup sahibi çıkarabilir.
 */
export function validateMemberRemoval({ group, actorId, targetId, balances, memberCount }) {
  if (actorId !== targetId && group.owner_id !== actorId) throw new HttpError(403, 'Üyeyi sadece grup sahibi çıkarabilir');
  if (!(targetId in balances)) throw new HttpError(404, 'Üye bulunamadı');
  if (targetId === group.owner_id && memberCount > 1) {
    throw bad('Grup sahibi, başka üyeler varken ayrılamaz. Önce üyeleri çıkar veya grubu sil');
  }
  if (balances[targetId] !== 0) throw bad('Bakiyesi sıfır olmayan üye çıkarılamaz, önce borçlar kapatılmalı');
}

/** Grubu yalnızca sahibi silebilir. */
export function assertOwner(group, userId) {
  if (group.owner_id !== userId) throw new HttpError(403, 'Bu işlemi sadece grup sahibi yapabilir');
}
