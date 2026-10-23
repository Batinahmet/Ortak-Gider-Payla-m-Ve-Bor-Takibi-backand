// Bir kullanıcıyı yönetici (admin) yapar. İlk yönetici kayıt formundan atanamaz (güvenlik gereği),
// bu script sunucuya erişimi olan kişi tarafından çalıştırılır.
//
// Kullanım (backend klasöründe):   npm run admin:promote -- ornek@mail.com
//                                  npm run admin:promote -- ornek@mail.com user    (yöneticiliği geri alır)
const { findUserByEmail, setUserRole } = await import('../src/data/index.js');

const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'user'].includes(role)) {
  console.error('Kullanım: npm run admin:promote -- <e-posta> [admin|user]');
  process.exit(1);
}
const user = findUserByEmail(email.toLowerCase());
if (!user) {
  console.error(`Kullanıcı bulunamadı: ${email}`);
  process.exit(1);
}
setUserRole(user.id, role);
console.log(`${user.email} artık '${role}' rolünde.`);
