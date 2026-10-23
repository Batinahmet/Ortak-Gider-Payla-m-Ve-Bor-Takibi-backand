import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { tx } from './db.js';
import * as data from './data/index.js';
import {
  hashPassword, newSession, destroySession, requireAuth, requireRole, login, changePassword,
  validatePassword, publicUser, purgeExpiredSessions,
} from './auth.js';
import { HttpError, bad } from './errors.js';
import {
  splitEqual,
  splitPercent,
  splitExact,
  splitItems,
  computeBalances,
  minimizeTransfers,
} from './split.js';
import { aiEnabled, scanReceipt, summarizeDebts } from './ai.js';

const { logActivity } = data;
const id = () => randomBytes(8).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteCode = () =>
  Array.from(randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Basit bellek içi hız sınırlayıcı (kaba kuvvet ve maliyetli yapay zeka çağrılarına karşı)
function limit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) return res.status(429).json({ error: 'Çok fazla istek, biraz bekle' });
    next();
  };
}

// Kayıt, giriş ve şifre değiştirme uçlarında IP başına dakikadaki istek sınırı (testlerde AUTH_RATE_LIMIT ile gevşetilir)
const AUTH_RATE = Number(process.env.AUTH_RATE_LIMIT) || 10;

const str = (v, name, max = 100) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(`Geçersiz alan: ${name}`);
  return v.trim();
};
const kurus = (v, name) => {
  if (!Number.isInteger(v) || v <= 0 || v > 1_000_000_000) throw bad(`${name} pozitif tam sayı (kuruş) olmalı`);
  return v;
};

export function createApp() {
  // Süresi dolan oturumları açılışta ve saatte bir sil (oturum süresi yönetimi)
  purgeExpiredSessions();
  setInterval(purgeExpiredSessions, 3_600_000).unref();

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '8mb' }));

  const api = express.Router();
  app.use('/api', api);

  api.get('/health', (req, res) => res.json({ ok: true, ai: aiEnabled() }));

  // ---------- Kimlik doğrulama ----------
  api.post(
    '/auth/register',
    limit(AUTH_RATE, 60_000),
    wrap(async (req, res) => {
      const name = str(req.body.name, 'ad', 50);
      const email = str(req.body.email, 'e-posta', 120).toLowerCase();
      const password = req.body.password;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Geçersiz e-posta');
      validatePassword(password);
      if (data.emailExists(email)) throw new HttpError(409, 'Bu e-posta zaten kayıtlı');
      const userId = id();
      // Rol istekten okunmaz (mass assignment): herkes 'user' olarak başlar, admin sadece sunucu tarafında atanır.
      data.createUser({ id: userId, name, email, passwordHash: await hashPassword(password) });
      res.status(201).json({ token: newSession(userId), user: publicUser({ id: userId, name, email, role: 'user' }) });
    }),
  );

  api.post(
    '/auth/login',
    limit(AUTH_RATE, 60_000),
    wrap(async (req, res) => {
      const email = str(req.body.email, 'e-posta', 120).toLowerCase();
      if (typeof req.body.password !== 'string') throw bad('Geçersiz alan: şifre');
      res.json(await login(email, req.body.password));
    }),
  );

  api.post('/auth/logout', requireAuth, (req, res) => {
    destroySession(req.token);
    res.json({ ok: true });
  });

  api.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  api.patch('/me', requireAuth, (req, res) => {
    const name = str(req.body.name, 'ad', 50);
    data.updateUserName(req.user.id, name);
    res.json({ user: { ...req.user, name } });
  });

  api.post(
    '/me/password',
    requireAuth,
    limit(AUTH_RATE, 60_000),
    wrap(async (req, res) => {
      const closed = await changePassword(req.user, req.body.currentPassword, req.body.newPassword, req.token);
      res.json({ ok: true, closedSessions: closed });
    }),
  );

  // ---------- Yönetici (rol tabanlı erişim) ----------
  // Yetki kontrolü sunucudadır: arayüzde link gizlenmesi güvenlik sağlamaz, bu uçlar kendi başına korunur.
  const adminOnly = [requireAuth, requireRole('admin')];

  api.get('/admin/users', ...adminOnly, (req, res) => res.json({ users: data.listUsersWithStats() }));

  api.patch('/admin/users/:uid/role', ...adminOnly, (req, res) => {
    const role = req.body.role;
    if (!['user', 'admin'].includes(role)) throw bad("role 'user' veya 'admin' olmalı");
    if (req.params.uid === req.user.id) throw bad('Kendi rolünü değiştiremezsin');
    if (!data.setUserRole(req.params.uid, role)) throw new HttpError(404, 'Kullanıcı bulunamadı');
    res.json({ ok: true });
  });

  // ---------- Gruplar ----------
  api.get('/groups', requireAuth, (req, res) => {
    res.json({ groups: data.listGroupsOfUser(req.user.id) });
  });

  api.post('/groups', requireAuth, (req, res) => {
    const name = str(req.body.name, 'grup adı', 60);
    const gid = id();
    tx(() => {
      data.createGroup({ id: gid, name, ownerId: req.user.id, inviteCode: inviteCode() });
      data.addMember(gid, req.user.id);
    });
    res.status(201).json({ id: gid, name });
  });

  api.post('/groups/join', requireAuth, limit(20, 60_000), (req, res) => {
    const code = str(req.body.code, 'davet kodu', 20).toUpperCase();
    const group = data.findGroupByInvite(code);
    if (!group) throw new HttpError(404, 'Davet kodu geçersiz');
    const added = data.addMember(group.id, req.user.id);
    if (added) logActivity(group.id, req.user.id, `${req.user.name} gruba katıldı`);
    res.json(group);
  });

  // Bu noktadan sonraki /groups/:gid/* uçları üyelik ister.
  const member = (req, res, next) => {
    const group = data.findGroup(req.params.gid);
    if (!group || !data.isMember(group.id, req.user.id)) return res.status(404).json({ error: 'Grup bulunamadı' });
    req.group = group;
    next();
  };
  const groupRoutes = express.Router({ mergeParams: true });
  api.use('/groups/:gid', requireAuth, member, groupRoutes);

  const members = data.listMembers;
  const tl = (k) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

  groupRoutes.get('/', (req, res) => {
    const g = req.group;
    res.json({ id: g.id, name: g.name, ownerId: g.owner_id, inviteCode: g.invite_code, members: members(g.id) });
  });

  // ---------- Harcamalar ----------
  const loadExpenses = data.listExpenses;

  groupRoutes.get('/expenses', (req, res) => {
    res.json({
      expenses: loadExpenses(req.group.id).map((e) => ({
        id: e.id, title: e.title, amount: e.amount, paidBy: e.paid_by, createdBy: e.created_by,
        splitType: e.split_type, items: e.items_json ? JSON.parse(e.items_json) : null,
        splits: e.splits, createdAt: e.created_at,
      })),
    });
  });

  groupRoutes.post('/expenses', (req, res) => {
    const gid = req.group.id;
    const ids = members(gid).map((m) => m.id);
    const isMember = (u) => ids.includes(u);
    const title = str(req.body.title, 'başlık', 120);
    const paidBy = req.body.paidBy ?? req.user.id;
    if (!isMember(paidBy)) throw bad('Ödeyen kişi grubun üyesi olmalı');

    const type = req.body.splitType ?? 'equal';
    let amount;
    let shares;
    let items = null;
    try {
      if (type === 'items') {
        if (!Array.isArray(req.body.items) || !req.body.items.length || req.body.items.length > 100) throw bad('Kalem listesi geçersiz');
        items = req.body.items.map((i) => ({
          name: str(i.name, 'kalem adı', 120),
          price: kurus(i.price, 'Kalem fiyatı'),
          to: i.to === 'all' ? 'all' : Array.isArray(i.to) ? i.to : [i.to],
        }));
        for (const it of items) {
          if (it.to !== 'all' && (!it.to.length || !it.to.every(isMember))) throw bad('Kalem katılımcıları grubun üyesi olmalı');
        }
        ({ total: amount, shares } = splitItems(items, ids));
      } else {
        amount = kurus(req.body.amount, 'Tutar');
        if (type === 'equal') {
          const parts = Array.isArray(req.body.participants) && req.body.participants.length ? req.body.participants : ids;
          if (!parts.every(isMember) || new Set(parts).size !== parts.length) throw bad('Katılımcılar grubun üyesi olmalı');
          shares = splitEqual(amount, parts);
        } else if (type === 'percent' || type === 'exact') {
          const input = req.body.shares;
          if (!input || typeof input !== 'object' || !Object.keys(input).every(isMember)) throw bad('Paylar geçersiz');
          shares = type === 'percent' ? splitPercent(amount, input) : splitExact(amount, input);
        } else throw bad('Bilinmeyen bölüşüm tipi');
      }
    } catch (e) {
      throw e instanceof HttpError ? e : bad(e.message);
    }

    const eid = id();
    tx(() => {
      data.insertExpense({ id: eid, groupId: gid, title, amount, paidBy, createdBy: req.user.id, splitType: type, items }, shares);
      logActivity(gid, req.user.id, `${req.user.name}, "${title}" harcamasını ekledi (${tl(amount)})`);
    });
    res.status(201).json({ id: eid, amount });
  });

  groupRoutes.delete('/expenses/:eid', (req, res) => {
    const e = data.findExpense(req.params.eid, req.group.id);
    if (!e) throw new HttpError(404, 'Harcama bulunamadı');
    if (e.created_by !== req.user.id && req.group.owner_id !== req.user.id) throw new HttpError(403, 'Sadece ekleyen veya grup sahibi silebilir');
    tx(() => {
      data.deleteExpense(e.id);
      logActivity(req.group.id, req.user.id, `${req.user.name}, "${e.title}" harcamasını sildi`);
    });
    res.json({ ok: true });
  });

  // ---------- Bakiye, borç netleştirme, ödeme kaydı ----------
  const currentBalances = (gid) => {
    const memberIds = members(gid).map((m) => m.id);
    const settlements = data.listSettlements(gid);
    const balances = computeBalances(memberIds, loadExpenses(gid), settlements);
    return { balances, transfers: minimizeTransfers(balances) };
  };

  groupRoutes.get('/balances', (req, res) => res.json(currentBalances(req.group.id)));

  groupRoutes.post('/settlements', (req, res) => {
    const to = req.body.to;
    const amount = kurus(req.body.amount, 'Tutar');
    if (!members(req.group.id).some((m) => m.id === to) || to === req.user.id) throw bad('Alıcı geçersiz');
    data.insertSettlement({ id: id(), groupId: req.group.id, fromUser: req.user.id, toUser: to, amount });
    const toName = members(req.group.id).find((m) => m.id === to).name;
    logActivity(req.group.id, req.user.id, `${req.user.name}, ${toName} kişisine ${tl(amount)} ödedi`);
    res.status(201).json({ ok: true });
  });

  groupRoutes.get('/activity', (req, res) => {
    res.json({ activity: data.listActivities(req.group.id) });
  });

  // ---------- Yapay zeka ----------
  const needAi = (req, res, next) =>
    aiEnabled() ? next() : res.status(503).json({ error: 'Yapay zeka kapalı: sunucuda ANTHROPIC_API_KEY tanımlı değil' });

  groupRoutes.get('/rules', (req, res) => {
    res.json({ rules: data.listRules(req.group.id) });
  });

  groupRoutes.post('/rules', (req, res) => {
    const item = str(req.body.item, 'kalem', 80).toLowerCase();
    if (!['ortak', 'kisisel'].includes(req.body.kind)) throw bad('kind ortak veya kisisel olmalı');
    data.upsertRule(req.group.id, item, req.body.kind);
    res.json({ ok: true });
  });

  groupRoutes.post('/receipts/scan', needAi, limit(15, 60_000), wrap(async (req, res) => {
    const { image, mediaType } = req.body;
    if (typeof image !== 'string' || image.length < 100 || image.length > 7_000_000) throw bad('Görsel geçersiz veya çok büyük');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType)) throw bad('Desteklenmeyen görsel türü');
    const rules = data.listRules(req.group.id);
    const scan = await scanReceipt(image, mediaType, rules);
    // Öğrenilmiş kural tam eşleşirse yapay zeka önerisinin yerine geçer.
    const learned = new Map(rules.map((r) => [r.item, r.kind]));
    const items = scan.items.map((i) => ({ ...i, suggestion: learned.get(i.name.toLowerCase().trim()) ?? i.suggestion }));
    res.json({ items, total: scan.total });
  }));

  groupRoutes.post('/summary', needAi, limit(15, 60_000), wrap(async (req, res) => {
    const names = Object.fromEntries(members(req.group.id).map((m) => [m.id, m.name]));
    const { transfers } = currentBalances(req.group.id);
    if (!transfers.length) return res.json({ summary: 'Borç yok, hesap denk.' });
    const lines = transfers.map((t) => `${names[t.from]} -> ${names[t.to]}: ${tl(t.amount)}`);
    res.json({ summary: await summarizeDebts(lines, req.user.name) });
  }));

  // ---------- Hata yönetimi ----------
  api.use((req, res) => res.status(404).json({ error: 'Bulunamadı' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });

  return app;
}
