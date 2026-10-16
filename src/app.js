import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { db, tx } from './db.js';
import { hashPassword, verifyPassword, newSession, destroySession, requireAuth } from './auth.js';
import {
  splitEqual,
  splitPercent,
  splitExact,
  splitItems,
  computeBalances,
  minimizeTransfers,
} from './split.js';
import { aiEnabled, scanReceipt, summarizeDebts } from './ai.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

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

const str = (v, name, max = 100) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(`Geçersiz alan: ${name}`);
  return v.trim();
};
const kurus = (v, name) => {
  if (!Number.isInteger(v) || v <= 0 || v > 1_000_000_000) throw bad(`${name} pozitif tam sayı (kuruş) olmalı`);
  return v;
};

export function createApp() {
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
    limit(10, 60_000),
    wrap(async (req, res) => {
      const name = str(req.body.name, 'ad', 50);
      const email = str(req.body.email, 'e-posta', 120).toLowerCase();
      const password = req.body.password;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Geçersiz e-posta');
      if (typeof password !== 'string' || password.length < 8) throw bad('Şifre en az 8 karakter olmalı');
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Bu e-posta zaten kayıtlı');
      const userId = id();
      db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)').run(
        userId, name, email, await hashPassword(password), Date.now(),
      );
      res.status(201).json({ token: newSession(userId), user: { id: userId, name, email } });
    }),
  );

  api.post(
    '/auth/login',
    limit(10, 60_000),
    wrap(async (req, res) => {
      const email = str(req.body.email, 'e-posta', 120).toLowerCase();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const ok = user && typeof req.body.password === 'string' && (await verifyPassword(req.body.password, user.password_hash));
      if (!ok) throw new HttpError(401, 'E-posta veya şifre hatalı');
      res.json({ token: newSession(user.id), user: { id: user.id, name: user.name, email: user.email } });
    }),
  );

  api.post('/auth/logout', requireAuth, (req, res) => {
    destroySession(req.token);
    res.json({ ok: true });
  });

  api.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------- Gruplar ----------
  api.get('/groups', requireAuth, (req, res) => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name FROM groups g JOIN members m ON m.group_id = g.id
         WHERE m.user_id = ? ORDER BY g.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ groups });
  });

  api.post('/groups', requireAuth, (req, res) => {
    const name = str(req.body.name, 'grup adı', 60);
    const gid = id();
    tx(() => {
      db.prepare('INSERT INTO groups (id, name, owner_id, invite_code, created_at) VALUES (?,?,?,?,?)').run(
        gid, name, req.user.id, inviteCode(), Date.now(),
      );
      db.prepare('INSERT INTO members (group_id, user_id, joined_at) VALUES (?,?,?)').run(gid, req.user.id, Date.now());
    });
    res.status(201).json({ id: gid, name });
  });

  api.post('/groups/join', requireAuth, limit(20, 60_000), (req, res) => {
    const code = str(req.body.code, 'davet kodu', 20).toUpperCase();
    const group = db.prepare('SELECT id, name FROM groups WHERE invite_code = ?').get(code);
    if (!group) throw new HttpError(404, 'Davet kodu geçersiz');
    const added = db
      .prepare('INSERT OR IGNORE INTO members (group_id, user_id, joined_at) VALUES (?,?,?)')
      .run(group.id, req.user.id, Date.now()).changes;
    if (added) logActivity(group.id, req.user.id, `${req.user.name} gruba katıldı`);
    res.json(group);
  });

  // Bu noktadan sonraki /groups/:gid/* uçları üyelik ister.
  const member = (req, res, next) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.gid);
    const isMember =
      group && db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
    if (!isMember) return res.status(404).json({ error: 'Grup bulunamadı' });
    req.group = group;
    next();
  };
  const groupRoutes = express.Router({ mergeParams: true });
  api.use('/groups/:gid', requireAuth, member, groupRoutes);

  const members = (gid) =>
    db
      .prepare('SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.joined_at')
      .all(gid);
  const logActivity = (gid, actor, message) =>
    db.prepare('INSERT INTO activities (group_id, actor_id, message, created_at) VALUES (?,?,?,?)').run(gid, actor, message, Date.now());
  const tl = (k) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

  groupRoutes.get('/', (req, res) => {
    const g = req.group;
    res.json({ id: g.id, name: g.name, ownerId: g.owner_id, inviteCode: g.invite_code, members: members(g.id) });
  });

  // ---------- Harcamalar ----------
  const loadExpenses = (gid) => {
    const rows = db.prepare('SELECT * FROM expenses WHERE group_id = ? ORDER BY created_at DESC, id DESC').all(gid);
    const splits = db
      .prepare('SELECT s.expense_id, s.user_id, s.share FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?')
      .all(gid);
    const byExpense = {};
    for (const s of splits) (byExpense[s.expense_id] ||= {})[s.user_id] = s.share;
    return rows.map((e) => ({ ...e, splits: byExpense[e.id] || {} }));
  };

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
      db.prepare(
        'INSERT INTO expenses (id, group_id, title, amount, paid_by, created_by, split_type, items_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ).run(eid, gid, title, amount, paidBy, req.user.id, type, items ? JSON.stringify(items) : null, Date.now());
      const ins = db.prepare('INSERT INTO expense_splits (expense_id, user_id, share) VALUES (?,?,?)');
      for (const [u, s] of Object.entries(shares)) if (s > 0) ins.run(eid, u, s);
      logActivity(gid, req.user.id, `${req.user.name}, "${title}" harcamasını ekledi (${tl(amount)})`);
    });
    res.status(201).json({ id: eid, amount });
  });

  groupRoutes.delete('/expenses/:eid', (req, res) => {
    const e = db.prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?').get(req.params.eid, req.group.id);
    if (!e) throw new HttpError(404, 'Harcama bulunamadı');
    if (e.created_by !== req.user.id && req.group.owner_id !== req.user.id) throw new HttpError(403, 'Sadece ekleyen veya grup sahibi silebilir');
    tx(() => {
      db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
      logActivity(req.group.id, req.user.id, `${req.user.name}, "${e.title}" harcamasını sildi`);
    });
    res.json({ ok: true });
  });

  // ---------- Bakiye, borç netleştirme, ödeme kaydı ----------
  const currentBalances = (gid) => {
    const memberIds = members(gid).map((m) => m.id);
    const settlements = db.prepare('SELECT from_user, to_user, amount FROM settlements WHERE group_id = ?').all(gid);
    const balances = computeBalances(memberIds, loadExpenses(gid), settlements);
    return { balances, transfers: minimizeTransfers(balances) };
  };

  groupRoutes.get('/balances', (req, res) => res.json(currentBalances(req.group.id)));

  groupRoutes.post('/settlements', (req, res) => {
    const to = req.body.to;
    const amount = kurus(req.body.amount, 'Tutar');
    if (!members(req.group.id).some((m) => m.id === to) || to === req.user.id) throw bad('Alıcı geçersiz');
    db.prepare('INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_at) VALUES (?,?,?,?,?,?)').run(
      id(), req.group.id, req.user.id, to, amount, Date.now(),
    );
    const toName = members(req.group.id).find((m) => m.id === to).name;
    logActivity(req.group.id, req.user.id, `${req.user.name}, ${toName} kişisine ${tl(amount)} ödedi`);
    res.status(201).json({ ok: true });
  });

  groupRoutes.get('/activity', (req, res) => {
    const rows = db
      .prepare('SELECT message, created_at AS createdAt FROM activities WHERE group_id = ? ORDER BY id DESC LIMIT 50')
      .all(req.group.id);
    res.json({ activity: rows });
  });

  // ---------- Yapay zeka ----------
  const needAi = (req, res, next) =>
    aiEnabled() ? next() : res.status(503).json({ error: 'Yapay zeka kapalı: sunucuda ANTHROPIC_API_KEY tanımlı değil' });

  groupRoutes.get('/rules', (req, res) => {
    res.json({ rules: db.prepare('SELECT item, kind FROM rules WHERE group_id = ?').all(req.group.id) });
  });

  groupRoutes.post('/rules', (req, res) => {
    const item = str(req.body.item, 'kalem', 80).toLowerCase();
    if (!['ortak', 'kisisel'].includes(req.body.kind)) throw bad('kind ortak veya kisisel olmalı');
    db.prepare(
      'INSERT INTO rules (group_id, item, kind) VALUES (?,?,?) ON CONFLICT(group_id, item) DO UPDATE SET kind = excluded.kind',
    ).run(req.group.id, item, req.body.kind);
    res.json({ ok: true });
  });

  groupRoutes.post('/receipts/scan', needAi, limit(15, 60_000), wrap(async (req, res) => {
    const { image, mediaType } = req.body;
    if (typeof image !== 'string' || image.length < 100 || image.length > 7_000_000) throw bad('Görsel geçersiz veya çok büyük');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType)) throw bad('Desteklenmeyen görsel türü');
    const rules = db.prepare('SELECT item, kind FROM rules WHERE group_id = ?').all(req.group.id);
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
