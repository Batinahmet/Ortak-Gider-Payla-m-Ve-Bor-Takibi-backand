-- Migration 002: kullanıcı rolleri ve başarısız giriş kilidi (Hafta 5: kimlik doğrulama ve yetkilendirme)
--
-- role            : 'user' (varsayılan) veya 'admin'. Rol sadece sunucu tarafında atanır, kayıt isteğinden okunmaz.
-- failed_attempts : art arda başarısız giriş sayısı (başarılı girişte sıfırlanır)
-- locked_until    : hesabın kilitli olduğu son an (ms, 0 = kilitli değil)

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0);
ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;
