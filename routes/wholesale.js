// Wholesale invoicing (dashboard only): shops, weekly invoices, "repeat last week",
// printable/emailable invoices and totals by week, month, quarter and year.
const path = require('path');
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../lib/auth');
const { clean } = require('../lib/orders');
const { sendInvoiceEmail } = require('../lib/mailer');

const router = express.Router();
router.use('/api/admin/wholesale', requireAdmin, express.json({ limit: '200kb' }));

// ---------- date helpers (plain calendar dates) ----------
const d = (iso) => new Date(iso + 'T12:00:00Z');
const iso = (dt) => dt.toISOString().slice(0, 10);
const add = (s, n) => { const x = d(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function weekOf(s) { const x = d(s); const mon = add(s, -((x.getUTCDay() + 6) % 7)); return [mon, add(mon, 6)]; }
function periodRange(period, s) {
  const x = d(s), y = x.getUTCFullYear(), m = x.getUTCMonth();
  if (period === 'week') return weekOf(s);
  if (period === 'month') return [iso(new Date(Date.UTC(y, m, 1, 12))), iso(new Date(Date.UTC(y, m + 1, 0, 12)))];
  if (period === 'quarter') { const q = Math.floor(m / 3) * 3; return [iso(new Date(Date.UTC(y, q, 1, 12))), iso(new Date(Date.UTC(y, q + 3, 0, 12)))]; }
  return [`${y}-01-01`, `${y}-12-31`];
}
function todayMaine() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// ---------- lines ----------
function cleanLines(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Add at least one line.');
  if (raw.length > 60) throw new Error('Too many lines.');
  return raw.map((l) => {
    const kind = l.kind === 'whole' ? 'whole' : 'mini';
    // She bills by total quantity and pulls a variety from stock, so flavor is optional.
    const flavor = clean(l.flavor, 60) || (kind === 'whole' ? 'Whole cheesecakes' : 'Cheesecake minis');
    const qty = Math.floor(Number(l.qty) || 0);
    const unit_cents = Math.round(Number(l.unit) * 100);
    if (qty < 1 || qty > 9999) throw new Error(`Check the quantity for ${flavor}.`);
    if (!Number.isFinite(unit_cents) || unit_cents < 0 || unit_cents > 100000) throw new Error(`Check the price for ${flavor}.`);
    return { flavor, kind, qty, unit_cents };
  });
}
const total = (lines) => lines.reduce((t, l) => t + l.qty * l.unit_cents, 0);
const nextNumber = () => (db.prepare('SELECT COALESCE(MAX(number), 1000) n FROM ws_invoices').get().n + 1);
const withCustomer = `SELECT i.*, c.name AS customer, c.town, c.email, c.address FROM ws_invoices i JOIN ws_customers c ON c.id = i.customer_id`;
const parse = (r) => r && ({ ...r, lines: JSON.parse(r.lines_json), lines_json: undefined });

// ---------- customers ----------
router.get('/api/admin/wholesale/customers', (req, res) => {
  res.json({ customers: db.prepare('SELECT * FROM ws_customers ORDER BY active DESC, name').all() });
});
router.post('/api/admin/wholesale/customers', (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  if (!name) return res.status(400).json({ error: 'Shop name required' });
  const r = db.prepare('INSERT INTO ws_customers (name, town, address, email, price_mini_cents, price_whole_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, clean(b.town, 60), clean(b.address, 200), clean(b.email, 120), Math.round((Number(b.price_mini) || 0) * 100), Math.round((Number(b.price_whole) || 0) * 100), clean(b.notes, 300));
  res.json({ ok: true, id: r.lastInsertRowid });
});
router.patch('/api/admin/wholesale/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM ws_customers WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE ws_customers SET name=?, town=?, address=?, email=?, price_mini_cents=?, price_whole_cents=?, notes=?, active=? WHERE id=?').run(
    b.name !== undefined ? clean(b.name, 80) || c.name : c.name,
    b.town !== undefined ? clean(b.town, 60) : c.town,
    b.address !== undefined ? clean(b.address, 200) : c.address,
    b.email !== undefined ? clean(b.email, 120) : c.email,
    b.price_mini !== undefined ? Math.round((Number(b.price_mini) || 0) * 100) : c.price_mini_cents,
    b.price_whole !== undefined ? Math.round((Number(b.price_whole) || 0) * 100) : c.price_whole_cents,
    b.notes !== undefined ? clean(b.notes, 300) : c.notes,
    b.active !== undefined ? (b.active ? 1 : 0) : c.active, c.id);
  res.json({ ok: true });
});
router.delete('/api/admin/wholesale/customers/:id', (req, res) => {
  db.prepare('DELETE FROM ws_customers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- invoices ----------
router.get('/api/admin/wholesale/invoices', (req, res) => {
  let { from, to } = req.query;
  if (req.query.week && isoDate(req.query.week)) [from, to] = weekOf(req.query.week);
  let sql = withCustomer + ' WHERE 1=1'; const args = [];
  if (isoDate(from)) { sql += ' AND i.invoice_date >= ?'; args.push(from); }
  if (isoDate(to)) { sql += ' AND i.invoice_date <= ?'; args.push(to); }
  sql += ' ORDER BY i.invoice_date DESC, c.name LIMIT 2000';
  res.json({ invoices: db.prepare(sql).all(...args).map(parse), from: from || null, to: to || null });
});
router.post('/api/admin/wholesale/invoices', (req, res) => {
  try {
    const b = req.body || {};
    const c = db.prepare('SELECT * FROM ws_customers WHERE id = ?').get(Number(b.customer_id));
    if (!c) throw new Error('Pick a shop.');
    if (!isoDate(b.invoice_date)) throw new Error('Pick a date.');
    const lines = cleanLines(b.lines);
    const r = db.prepare('INSERT INTO ws_invoices (number, customer_id, invoice_date, lines_json, total_cents, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nextNumber(), c.id, b.invoice_date, JSON.stringify(lines), total(lines), clean(b.notes, 300));
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/api/admin/wholesale/invoices/:id', (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM ws_invoices WHERE id = ?').get(Number(req.params.id));
    if (!inv) throw new Error('Not found');
    const b = req.body || {};
    const lines = cleanLines(b.lines);
    const cid = db.prepare('SELECT id FROM ws_customers WHERE id = ?').get(Number(b.customer_id)) ? Number(b.customer_id) : inv.customer_id;
    db.prepare('UPDATE ws_invoices SET customer_id=?, invoice_date=?, lines_json=?, total_cents=?, notes=? WHERE id=?')
      .run(cid, isoDate(b.invoice_date) ? b.invoice_date : inv.invoice_date, JSON.stringify(lines), total(lines), clean(b.notes, 300), inv.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Status changes. Marking paid records how (cash, check, card, EFT), the check number and the date.
const PAY_METHODS = ['cash', 'check', 'card', 'eft'];
router.patch('/api/admin/wholesale/invoices/:id', (req, res) => {
  const b = req.body || {};
  const inv = db.prepare('SELECT * FROM ws_invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'sent', 'paid'].includes(b.status)) return res.status(400).json({ error: 'Bad status' });
  if (b.status === 'paid') {
    const method = PAY_METHODS.includes(b.pay_method) ? b.pay_method : null;
    if (!method) return res.status(400).json({ error: 'Pick how they paid.' });
    const checkNo = method === 'check' ? clean(b.check_no, 30) : '';
    if (method === 'check' && !checkNo) return res.status(400).json({ error: 'Enter the check number.' });
    const paidOn = isoDate(b.paid_on) ? b.paid_on : todayMaine();
    db.prepare("UPDATE ws_invoices SET status = 'paid', pay_method = ?, check_no = ?, paid_on = ? WHERE id = ?").run(method, checkNo || null, paidOn, inv.id);
  } else {
    db.prepare('UPDATE ws_invoices SET status = ?, pay_method = NULL, check_no = NULL, paid_on = NULL WHERE id = ?').run(b.status, inv.id);
  }
  res.json({ ok: true });
});
router.delete('/api/admin/wholesale/invoices/:id', (req, res) => {
  db.prepare('DELETE FROM ws_invoices WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Repeat last week: copy every invoice from the week before `week` into `week`,
// moved forward 7 days, as new drafts. Shops already invoiced this week are skipped.
router.post('/api/admin/wholesale/repeat', (req, res) => {
  const week = isoDate(req.body && req.body.week) ? req.body.week : todayMaine();
  const [mon, sun] = weekOf(week);
  const prev = db.prepare('SELECT * FROM ws_invoices WHERE invoice_date BETWEEN ? AND ?').all(add(mon, -7), add(sun, -7));
  const already = new Set(db.prepare('SELECT customer_id FROM ws_invoices WHERE invoice_date BETWEEN ? AND ?').all(mon, sun).map((r) => r.customer_id));
  const ins = db.prepare('INSERT INTO ws_invoices (number, customer_id, invoice_date, lines_json, total_cents, notes, demo) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let made = 0, skipped = 0;
  db.transaction(() => {
    for (const inv of prev) {
      if (already.has(inv.customer_id)) { skipped++; continue; }
      ins.run(nextNumber(), inv.customer_id, add(inv.invoice_date, 7), inv.lines_json, inv.total_cents, inv.notes, inv.demo); // copies as an unpaid draft
      already.add(inv.customer_id); made++;
    }
  })();
  res.json({ ok: true, made, skipped, from_week: add(mon, -7) });
});

// Totals for a week, month, quarter or year: dollars, paid/unpaid, quantities and per-flavor counts.
router.get('/api/admin/wholesale/report', (req, res) => {
  const period = ['week', 'month', 'quarter', 'year', 'custom'].includes(req.query.period) ? req.query.period : 'week';
  const date = isoDate(req.query.date) ? req.query.date : todayMaine();
  let from, to;
  if (period === 'custom') {
    // Any date range the owner picks (e.g. Nov 3 to Dec 15). Swapped if entered backwards.
    from = isoDate(req.query.from) ? req.query.from : date;
    to = isoDate(req.query.to) ? req.query.to : from;
    if (from > to) [from, to] = [to, from];
  } else {
    [from, to] = periodRange(period, date);
  }
  const rows = db.prepare(withCustomer + ' WHERE i.invoice_date BETWEEN ? AND ?').all(from, to).map(parse);
  const out = { period, from, to, invoices: rows.length, total_cents: 0, paid_cents: 0, unpaid_cents: 0, minis: 0, wholes: 0, shops: {}, methods: {} };
  for (const r of rows) {
    out.total_cents += r.total_cents;
    if (r.status === 'paid') {
      out.paid_cents += r.total_cents;
      const m = out.methods[r.pay_method || 'other'] = out.methods[r.pay_method || 'other'] || { count: 0, cents: 0 };
      m.count++; m.cents += r.total_cents;
    } else out.unpaid_cents += r.total_cents;
    const sh = out.shops[r.customer] = out.shops[r.customer] || { minis: 0, wholes: 0, cents: 0 };
    sh.cents += r.total_cents;
    for (const l of r.lines) {
      if (l.kind === 'whole') { out.wholes += l.qty; sh.wholes += l.qty; } else { out.minis += l.qty; sh.minis += l.qty; }
    }
  }
  // Everything still owed, from any week, oldest first.
  out.owed = db.prepare(withCustomer + " WHERE i.status != 'paid' ORDER BY i.invoice_date, c.name LIMIT 500").all()
    .map((r) => ({ id: r.id, number: r.number, customer: r.customer, invoice_date: r.invoice_date, total_cents: r.total_cents, status: r.status }));
  res.json(out);
});

router.post('/api/admin/wholesale/clear-demo', (req, res) => {
  db.prepare('DELETE FROM ws_invoices WHERE demo = 1').run();
  db.prepare('DELETE FROM ws_customers WHERE demo = 1').run();
  res.json({ ok: true });
});

router.post('/api/admin/wholesale/invoices/:id/email', async (req, res) => {
  const inv = parse(db.prepare(withCustomer + ' WHERE i.id = ?').get(Number(req.params.id)));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!inv.email) return res.status(400).json({ error: `${inv.customer} doesn't have an email saved. Add one under Shops.` });
  try {
    await sendInvoiceEmail(inv, renderInvoice(inv, false));
    if (inv.status === 'draft') db.prepare("UPDATE ws_invoices SET status = 'sent' WHERE id = ?").run(inv.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- printable invoice ----------
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function renderInvoice(inv, withPrintButton) {
  const site = process.env.SITE_URL || 'https://batterupbakery.onrender.com';
  const dt = d(inv.invoice_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  const rows = inv.lines.map((l) => `<tr><td>${esc(l.flavor)}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${money(l.unit_cents)}</td><td style="text-align:right">${money(l.qty * l.unit_cents)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.number} | Batter Up Bakery</title>
<style>body{font-family:Arial,sans-serif;color:#2b1630;margin:0;padding:32px;background:#fff}.inv{max-width:720px;margin:0 auto}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #56085c;padding-bottom:16px}
.top img{width:96px;height:96px;border-radius:50%}h1{color:#56085c;margin:0;font-size:28px}table{width:100%;border-collapse:collapse;margin-top:18px}
th{background:#f3e9f4;color:#33043a;text-align:left;padding:8px;font-size:13px}td{padding:8px;border-bottom:1px solid #eee;font-size:14px}
.tot{text-align:right;font-size:20px;font-weight:bold;color:#56085c;margin-top:14px}.muted{color:#6b5a6e;font-size:13px}
.btn{background:#56085c;color:#fff;border:0;border-radius:99px;padding:10px 18px;font-weight:bold;cursor:pointer}@media print{.noprint{display:none}body{padding:0}}</style></head>
<body><div class="inv">${withPrintButton ? '<p class="noprint"><button class="btn" onclick="print()">Print or save as PDF</button></p>' : ''}
<div class="top"><div><h1>Invoice #${inv.number}</h1><div class="muted">${dt}</div></div><img src="${site}/img/logo.jpg" alt="Batter Up Bakery"></div>
<div style="display:flex;justify-content:space-between;gap:24px;margin-top:16px">
<div><div class="muted">FROM</div><b>Batter Up Bakery</b><br>1160 Lewiston Road, Litchfield, ME<br>(207) 588-7628<br>batterupbakerymaine@outlook.com</div>
<div style="text-align:right"><div class="muted">BILL TO</div><b>${esc(inv.customer)}</b>${inv.address ? '<br>' + esc(inv.address) : ''}${inv.town && !(inv.address || '').includes(inv.town) ? '<br>' + esc(inv.town) : ''}${inv.email ? '<br>' + esc(inv.email) : ''}</div></div>
<table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot">Total ${money(inv.total_cents)}</div>
${inv.status === 'paid' ? `<p class="tot" style="font-size:15px;color:#3c5410">PAID${inv.pay_method ? ' by ' + ({ cash: 'cash', check: 'check', card: 'card', eft: 'EFT' }[inv.pay_method]) : ''}${inv.check_no ? ' #' + esc(inv.check_no) : ''}${inv.paid_on ? ' on ' + d(inv.paid_on).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : ''}</p>` : ''}
${inv.notes ? `<p><b>Notes:</b> ${esc(inv.notes)}</p>` : ''}
<p class="muted" style="margin-top:30px">Thank you for supporting our small family business!</p></div></body></html>`;
}
router.get('/admin/invoice/:id', requireAdmin, (req, res) => {
  const inv = parse(db.prepare(withCustomer + ' WHERE i.id = ?').get(Number(req.params.id)));
  if (!inv) return res.status(404).send('Invoice not found');
  res.send(renderInvoice(inv, true));
});

module.exports = router;
