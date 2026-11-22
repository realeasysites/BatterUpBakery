// Website traffic: where visitors come from (Facebook, Google, direct...), which pages they
// view, taps on call/Messenger/Facebook, and which sources turn into orders.
// No cookies and no outside service: a visitor is a daily hash of IP + browser, never stored raw.
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../lib/auth');

db.exec(`
CREATE TABLE IF NOT EXISTS sa_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')),
  visitor TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT, device TEXT, landing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sa_views_day ON sa_views(day);
CREATE TABLE IF NOT EXISTS sa_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')),
  visitor TEXT NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sa_events_day ON sa_events(day);
`);
const oc = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!oc.includes('source')) db.exec('ALTER TABLE orders ADD COLUMN source TEXT');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const secret = process.env.SESSION_SECRET || 'bub';
const visitorId = (req) => crypto.createHash('sha256').update(`${secret}|${today()}|${req.ip}|${req.get('user-agent') || ''}`).digest('hex').slice(0, 16);
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime/i;
const s = (v, n) => String(v || '').slice(0, n).replace(/[\u0000-\u001f<>]/g, '');

// Turn utm tags / click ids / referrer into a plain-English source.
function classify(b, host) {
  const utm = s(b.utm, 40).toLowerCase();
  if (utm) {
    if (/^(fb|facebook)/.test(utm)) return 'Facebook';
    if (/^(ig|insta)/.test(utm)) return 'Instagram';
    if (/^(gbp|google ?business|gmb|maps)/.test(utm)) return 'Google Business Profile';
    if (/^google/.test(utm)) return 'Google';
    if (/^(qr|flyer|card|label|sticker)/.test(utm)) return 'QR code / print';
    if (/^(email|newsletter)/.test(utm)) return 'Email';
    return utm[0].toUpperCase() + utm.slice(1);
  }
  if (b.fbclid) return 'Facebook';
  if (b.gclid) return 'Google Ads';
  let ref = '';
  try { ref = new URL(b.ref).hostname.replace(/^www\./, ''); } catch (e) { ref = ''; }
  if (!ref || ref === host) return 'Direct / typed in';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(ref)) return 'Facebook';
  if (/instagram\.com$/.test(ref)) return 'Instagram';
  if (/google\./.test(ref)) return 'Google';
  if (/bing\.com|duckduckgo|yahoo\./.test(ref)) return 'Other search';
  if (/tiktok\.com/.test(ref)) return 'TikTok';
  if (/realeasysites|getrealeasysites/.test(ref)) return 'Real Easy Sites';
  return ref;
}

const router = express.Router();
const EVENTS = ['call', 'text', 'messenger', 'facebook', 'order_start', 'email'];
router.post('/api/t', express.json({ limit: '4kb' }), (req, res) => {
  res.status(204).end();
  try {
    const ua = req.get('user-agent') || '';
    if (BOT.test(ua)) return;
    const b = req.body || {};
    const host = (req.get('host') || '').replace(/^www\./, '').split(':')[0];
    const source = b.src ? s(b.src, 60) : classify(b, host);
    const v = visitorId(req);
    if (b.type === 'view') {
      const path = s(b.path, 120) || '/';
      if (path.startsWith('/admin')) return;
      const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Computer';
      db.prepare('INSERT INTO sa_views (day, visitor, path, source, campaign, device, landing) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(today(), v, path, source, s(b.campaign, 60) || null, device, b.landing ? 1 : 0);
    } else if (EVENTS.includes(b.type)) {
      db.prepare('INSERT INTO sa_events (day, visitor, type, source) VALUES (?, ?, ?, ?)').run(today(), v, b.type, source);
    }
  } catch (e) { console.error('traffic log failed', e.message); }
});
router.get('/api/admin/traffic', requireAdmin, (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (days - 1));
  const from = d.toISOString().slice(0, 10);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const visitors = one('SELECT COUNT(DISTINCT day || visitor) n FROM sa_views WHERE day >= ?', from).n;
  const views = one('SELECT COUNT(*) n FROM sa_views WHERE day >= ?', from).n;
  const orderRows = all("SELECT source, total_cents FROM orders WHERE date(created_at, '-5 hours') >= ? AND status != 'cancelled'", from);
  const sources = {};
  const S = (k) => (sources[k] = sources[k] || { visitors: 0, orders: 0, revenue_cents: 0, taps: 0 });
  for (const r of all('SELECT source, COUNT(DISTINCT day || visitor) n FROM sa_views WHERE day >= ? AND landing = 1 GROUP BY source', from)) S(r.source).visitors = r.n;
  for (const r of orderRows) { const x = S(r.source || 'Unknown (before tracking)'); x.orders++; x.revenue_cents += r.total_cents; }
  for (const r of all("SELECT source, COUNT(*) n FROM sa_events WHERE day >= ? AND type IN ('call','text','messenger') GROUP BY source", from)) S(r.source).taps = r.n;
  const taps = {}; for (const r of all('SELECT type, COUNT(*) n FROM sa_events WHERE day >= ? GROUP BY type', from)) taps[r.type] = r.n;
  res.json({
    days, from, visitors, views, orders: orderRows.length, revenue_cents: orderRows.reduce((t, r) => t + r.total_cents, 0), taps,
    sources: Object.entries(sources).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.visitors - a.visitors || b.orders - a.orders),
    pages: all('SELECT path, COUNT(*) views FROM sa_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 10', from),
    devices: all('SELECT device, COUNT(DISTINCT day || visitor) n FROM sa_views WHERE day >= ? GROUP BY device ORDER BY n DESC', from),
    campaigns: all("SELECT campaign, source, COUNT(DISTINCT day || visitor) n FROM sa_views WHERE day >= ? AND campaign IS NOT NULL AND landing = 1 GROUP BY campaign, source ORDER BY n DESC LIMIT 10", from),
    daily: all('SELECT day, COUNT(DISTINCT visitor) n FROM sa_views WHERE day >= ? GROUP BY day ORDER BY day', from)
  });
});

module.exports = router;
module.exports.classify = classify;
