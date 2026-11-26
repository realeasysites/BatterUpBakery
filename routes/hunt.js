// Cheesecake Hunt giveaway: visitors find 5 hidden cheesecakes around the site,
// which unlocks the entry form in their own browser. One entry per phone number.
const express = require('express');
const { db, getSettings, setSetting } = require('../db');
const { requireAdmin } = require('../lib/auth');
const { clean } = require('../lib/orders');

const router = express.Router();

function todayMaine() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
function huntState() {
  const s = getSettings();
  const t = todayMaine();
  const started = t >= (s.hunt_start || '');
  // Entries close at 6 PM Maine time on the end date, so winners can be drawn that night.
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const beforeClose = t < (s.hunt_end || '') || (t === s.hunt_end && hm < '18:00');
  const open = s.hunt_on === '1' && started && beforeClose;
  return { on: s.hunt_on === '1', open, started, start: s.hunt_start, end: s.hunt_end, prize: s.hunt_prize, winners: Number(s.hunt_winners) || 1 };
}

router.get('/api/hunt', (req, res) => res.json(huntState()));

const hits = new Map();
router.post('/api/hunt/enter', express.json({ limit: '10kb' }), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });                 // honeypot
  const st = huntState();
  // Before launch, entries are allowed only from the preview link (for testing); they can be cleared in the dashboard.
  const preview = b.preview === true && st.on && !st.started;
  if (!st.open && !preview) return res.status(400).json({ error: st.started ? 'The Cheesecake Hunt is closed. Thanks for playing!' : "The Cheesecake Hunt hasn't started yet!" });
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= 10) return res.status(429).json({ error: 'Too many tries. Please try again later.' });
  list.push(now); hits.set(req.ip, list);
  const found = Array.isArray(b.found) ? new Set(b.found.map(Number).filter((n) => n >= 1 && n <= 5)) : new Set();
  if (found.size < 5) return res.status(400).json({ error: 'Find all 5 hidden cheesecakes first!' });
  const name = clean(b.name, 80), phone = clean(b.phone, 30), email = clean(b.email, 120);
  const key = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (key.length !== 10) return res.status(400).json({ error: 'Please enter a 10-digit phone number so we can reach you if you win.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "That email doesn't look right." });
  try {
    db.prepare('INSERT INTO hunt_entries (name, phone, phone_key, email) VALUES (?, ?, ?, ?)').run(name, phone, key, email || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json({ ok: true, already: true });
    throw e;
  }
  res.json({ ok: true });
});

// ---- dashboard ----
router.use('/api/admin/hunt', requireAdmin, express.json());
router.get('/api/admin/hunt', (req, res) => {
  res.json({ ...huntState(), entries: db.prepare('SELECT * FROM hunt_entries ORDER BY winner DESC, created_at DESC').all() });
});
router.put('/api/admin/hunt', (req, res) => {
  const b = req.body || {};
  if (b.on !== undefined) setSetting('hunt_on', b.on ? '1' : '0');
  if (b.end && /^\d{4}-\d{2}-\d{2}$/.test(b.end)) setSetting('hunt_end', b.end);
  if (b.start && /^\d{4}-\d{2}-\d{2}$/.test(b.start)) setSetting('hunt_start', b.start);
  if (b.prize !== undefined) setSetting('hunt_prize', clean(b.prize, 120));
  if (b.winners !== undefined) setSetting('hunt_winners', String(Math.max(1, Math.min(20, Number(b.winners) || 1))));
  res.json({ ok: true });
});
// Draw winners at random from entries that haven't won yet, up to the number of winners set.
router.post('/api/admin/hunt/draw', (req, res) => {
  const st = huntState();
  const have = db.prepare('SELECT COUNT(*) n FROM hunt_entries WHERE winner = 1').get().n;
  const need = Math.max(0, st.winners - have);
  const pool = db.prepare('SELECT id FROM hunt_entries WHERE winner = 0').all();
  const picked = [];
  for (let i = 0; i < need && pool.length; i++) {
    const j = require('crypto').randomInt(pool.length);
    picked.push(pool.splice(j, 1)[0].id);
  }
  const mark = db.prepare('UPDATE hunt_entries SET winner = 1 WHERE id = ?');
  db.transaction(() => picked.forEach((id) => mark.run(id)))();
  res.json({ ok: true, picked: picked.length });
});
router.patch('/api/admin/hunt/entries/:id', (req, res) => {
  db.prepare('UPDATE hunt_entries SET winner = ? WHERE id = ?').run(req.body && req.body.winner ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/api/admin/hunt/entries/:id', (req, res) => {
  db.prepare('DELETE FROM hunt_entries WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
router.post('/api/admin/hunt/clear', (req, res) => {
  db.prepare('DELETE FROM hunt_entries').run();
  res.json({ ok: true });
});

module.exports = router;
