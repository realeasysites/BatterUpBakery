// Owner dashboard: login, orders, flavors, route stops, prices/settings.
const path = require('path');
const express = require('express');
const { db, getSettings, setSetting } = require('../db');
const { passwordOk, setSession, clearSession, requireAdmin, isAuthed } = require('../lib/auth');
const { currentCycle } = require('../lib/schedule');
const { clean } = require('../lib/orders');

const router = express.Router();
const VIEWS = path.join(__dirname, '..', 'views');

// ---- login (password only) ----
const attempts = new Map();
router.get('/admin/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/admin');
  res.sendFile(path.join(VIEWS, 'login.html'));
});
router.post('/admin/login', express.urlencoded({ extended: false }), (req, res) => {
  const now = Date.now();
  const list = (attempts.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (list.length >= 10) return res.redirect('/admin/login?e=wait');
  if (!process.env.ADMIN_PASSWORD) return res.redirect('/admin/login?e=off');
  if (!passwordOk(req.body && req.body.password)) {
    list.push(now); attempts.set(req.ip, list);
    return res.redirect('/admin/login?e=bad');
  }
  attempts.delete(req.ip);
  setSession(res, req);
  res.redirect('/admin');
});
router.post('/admin/logout', (req, res) => { clearSession(res); res.redirect('/admin/login'); });

// ---- everything below needs the password ----
router.get(['/admin', '/admin/'], requireAdmin, (req, res) => res.sendFile(path.join(VIEWS, 'admin.html')));
router.use('/api/admin', requireAdmin, express.json({ limit: '200kb' }));

router.get('/api/admin/overview', (req, res) => {
  res.json({ cycle: currentCycle(), settings: getSettings(), features: { wholesale: process.env.WHOLESALE_ENABLED === '1', playground: process.env.PLAYGROUND === '1' } });
});

// Orders
router.get('/api/admin/orders', (req, res) => {
  const { from, to, status } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const args = [];
  if (from) { sql += ' AND fulfill_date >= ?'; args.push(from); }
  if (to) { sql += ' AND fulfill_date <= ?'; args.push(to); }
  if (status && status !== 'all') { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY fulfill_date DESC, created_at DESC LIMIT 1000';
  const rows = db.prepare(sql).all(...args).map((o) => ({ ...o, items: JSON.parse(o.items_json), items_json: undefined }));
  res.json({ orders: rows });
});
const STATUSES = ['new', 'confirmed', 'ready', 'done', 'cancelled'];
router.patch('/api/admin/orders/:id', (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/api/admin/orders/:id', (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Flavors
router.get('/api/admin/flavors', (req, res) => res.json({ flavors: db.prepare('SELECT * FROM flavors ORDER BY sort, name').all() }));
router.post('/api/admin/flavors', (req, res) => {
  const name = clean(req.body.name, 60);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM flavors').get().m;
  const r = db.prepare('INSERT INTO flavors (name, gf, seasonal, sort) VALUES (?, ?, ?, ?)').run(name, req.body.gf ? 1 : 0, req.body.seasonal ? 1 : 0, max + 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});
router.patch('/api/admin/flavors/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM flavors WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  db.prepare('UPDATE flavors SET name = ?, gf = ?, seasonal = ?, active = ? WHERE id = ?').run(
    b.name !== undefined ? clean(b.name, 60) || f.name : f.name,
    b.gf !== undefined ? (b.gf ? 1 : 0) : f.gf,
    b.seasonal !== undefined ? (b.seasonal ? 1 : 0) : f.seasonal,
    b.active !== undefined ? (b.active ? 1 : 0) : f.active,
    f.id);
  res.json({ ok: true });
});
router.delete('/api/admin/flavors/:id', (req, res) => {
  db.prepare('DELETE FROM flavors WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Route stops / retail locations
router.get('/api/admin/stops', (req, res) => res.json({ stops: db.prepare('SELECT * FROM stops ORDER BY day DESC, route, sort, name').all() }));
router.post('/api/admin/stops', (req, res) => {
  const name = clean(req.body.name, 80), town = clean(req.body.town, 60);
  const day = req.body.day === 'Tuesday' ? 'Tuesday' : 'Wednesday';
  const route = Math.max(1, Math.min(9, Number(req.body.route) || 1));
  if (!name || !town) return res.status(400).json({ error: 'Name and town required' });
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM stops').get().m;
  const r = db.prepare('INSERT INTO stops (name, town, day, route, sort) VALUES (?, ?, ?, ?, ?)').run(name, town, day, route, max + 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});
router.patch('/api/admin/stops/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM stops WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  db.prepare('UPDATE stops SET name = ?, town = ?, day = ?, route = ?, active = ? WHERE id = ?').run(
    b.name !== undefined ? clean(b.name, 80) || s.name : s.name,
    b.town !== undefined ? clean(b.town, 60) || s.town : s.town,
    b.day === 'Tuesday' || b.day === 'Wednesday' ? b.day : s.day,
    b.route !== undefined ? Math.max(1, Math.min(9, Number(b.route) || 1)) : s.route,
    b.active !== undefined ? (b.active ? 1 : 0) : s.active,
    s.id);
  res.json({ ok: true });
});
router.delete('/api/admin/stops/:id', (req, res) => {
  db.prepare('DELETE FROM stops WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Prices and settings
const PRICE_KEYS = ['price_whole', 'price_gf_addon', 'price_mini6', 'price_mini10x5', 'price_mini10x10'];
router.put('/api/admin/settings', (req, res) => {
  const b = req.body || {};
  for (const k of PRICE_KEYS) {
    if (b[k] === undefined) continue;
    const cents = Math.round(Number(b[k]) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > 100000) return res.status(400).json({ error: 'Check the prices' });
    setSetting(k, cents);
  }
  if (b.orders_open !== undefined) setSetting('orders_open', b.orders_open ? '1' : '0');
  if (b.announcement !== undefined) setSetting('announcement', clean(b.announcement, 200));
  res.json({ ok: true, settings: getSettings() });
});

module.exports = router;
