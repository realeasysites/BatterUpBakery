// Public API: menu (flavors + prices + this week's dates), route stops, place an order.
const express = require('express');
const { db, getSettings } = require('../db');
const { currentCycle } = require('../lib/schedule');
const { productsWithPrices, priceItems, OrderError, clean, newCode } = require('../lib/orders');
const { sendOrderEmails } = require('../lib/mailer');
const square = require('../lib/square');

const router = express.Router();

// Flavor photos: drop a file named after the flavor (e.g. "Brownie Bash" -> brownie-bash.jpg)
// into public/img/flavors and it shows up on the site. ?v= busts the cache when a photo is replaced.
const fs = require('fs');
const path = require('path');
const FLAVOR_DIR = path.join(__dirname, '..', 'public', 'img', 'flavors');
const slug = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function flavorPhotos() {
  const out = {};
  try {
    for (const f of fs.readdirSync(FLAVOR_DIR)) {
      const m = f.match(/^(.+)\.(jpe?g|png|webp)$/i);
      if (m) out[m[1].toLowerCase()] = `/img/flavors/${f}?v=${Math.floor(fs.statSync(path.join(FLAVOR_DIR, f)).mtimeMs)}`;
    }
  } catch (e) { /* no photos folder yet */ }
  return out;
}

function activeFlavors() {
  const photos = flavorPhotos();
  return db.prepare('SELECT id, name, gf, seasonal FROM flavors WHERE active = 1 ORDER BY sort, name').all()
    .map((f) => ({ ...f, photo: photos[slug(f.name)] || null }));
}
function activeStops() {
  return db.prepare('SELECT id, name, town, day, route FROM stops WHERE active = 1 ORDER BY day DESC, route, sort, name').all();
}

router.get('/menu', (req, res) => {
  const s = getSettings();
  res.json({
    flavors: activeFlavors(),
    ...productsWithPrices(s),
    orders_open: s.orders_open !== '0',
    card_payments: square.enabled(),
    announcement: s.announcement || '',
    cycle: currentCycle()
  });
});

router.get('/stops', (req, res) => res.json({ stops: activeStops() }));

// Light spam protection: a few orders per hour per address.
// Only orders that go through count, so typos and fixes never lock anyone out.
const hits = new Map();
function recent(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  hits.set(ip, list);
  return list;
}
function rateLimited(ip) { return recent(ip).length >= 8; }
function recordOrder(ip) { recent(ip).push(Date.now()); }

router.post('/orders', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true, code: 'BUB-THANKS' }); // honeypot field: bots fill it, people don't
    if (rateLimited(req.ip)) throw new OrderError('Too many orders from this connection. Please call or message us.');
    const s = getSettings();
    if (s.orders_open === '0') throw new OrderError('Online ordering is paused right now. Please message us on Facebook or call (207) 588-7628.');

    const name = clean(b.name, 80);
    const phone = clean(b.phone, 30);
    const email = clean(b.email, 120);
    const notes = clean(b.notes, 600);
    if (!name) throw new OrderError('Please enter your name.');
    if (phone.replace(/\D/g, '').length < 10) throw new OrderError('Please enter a phone number we can reach you at.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OrderError('That email address doesn\'t look right.');

    const flavorsById = new Map(activeFlavors().map((f) => [f.id, f]));
    const { items, total_cents } = priceItems(b.items, flavorsById, s);

    const cycle = currentCycle();
    let fulfillment = b.fulfillment;
    let fulfill_date = null, stop_id = null, stop_label = null, ship_address = null, fulfillment_label;
    if (fulfillment === 'route') {
      const stop = db.prepare('SELECT * FROM stops WHERE id = ? AND active = 1').get(Number(b.stop_id));
      if (!stop) throw new OrderError('Please pick a meet-up spot on our delivery route.');
      fulfill_date = cycle.route[stop.day].date;
      stop_id = stop.id;
      stop_label = `${stop.name}, ${stop.town}`;
      fulfillment_label = `Route meet-up: ${stop_label} on ${cycle.route[stop.day].label}`;
    } else if (fulfillment === 'pickup') {
      const day = cycle.pickup.find((d) => d.date === b.pickup_date);
      if (!day) throw new OrderError('Please pick a pickup day.');
      fulfill_date = day.date;
      fulfillment_label = `Pickup at the BUB Shed (1160 Lewiston Rd, Litchfield) on ${day.label}, 9 AM to 5 PM`;
    } else if (fulfillment === 'ship') {
      if (items.some((i) => i.type === 'whole')) throw new OrderError("Whole cheesecakes can't be shipped. Please choose pickup or a route meet-up, or ship only mini packs.");
      ship_address = clean(b.ship_address, 300);
      if (ship_address.length < 10) throw new OrderError('Please enter the full shipping address.');
      if (!/\b(ME|Maine)\b/i.test(ship_address)) throw new OrderError('We ship within the State of Maine. Please include ME in the address.');
      fulfill_date = cycle.ship.date;
      fulfillment_label = `UPS shipping (ships ${cycle.ship.label}) to ${ship_address}`;
    } else {
      throw new OrderError('Please choose pickup, route meet-up or shipping.');
    }

    // Card payment now (Square) for pickup/route orders; shipping is paid later once the fee is known.
    const payCard = b.pay === 'card' && square.enabled() && fulfillment !== 'ship';
    const code = newCode();
    db.prepare(`INSERT INTO orders (code, name, phone, email, fulfillment, fulfill_date, stop_id, stop_label, ship_address, items_json, total_cents, notes, pay_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, name, phone, email || null, fulfillment, fulfill_date, stop_id, stop_label, ship_address, JSON.stringify(items), total_cents, notes || null, payCard ? 'card' : 'later');

    recordOrder(req.ip);
    const order = { code, name, phone, email, notes, fulfillment, fulfillment_label, items, total_cents, pay_method: payCard ? 'card' : 'later' };
    let pay_url = null, pay_error = null;
    if (payCard) {
      try {
        const site = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
        const link = await square.createPaymentLink(order, site);
        pay_url = link.url;
        db.prepare('UPDATE orders SET square_order_id = ?, pay_url = ? WHERE code = ?').run(link.orderId, link.url, code);
      } catch (e) {
        console.error(`order ${code}: Square payment link failed: ${e.message}`);
        db.prepare("UPDATE orders SET pay_method = 'later' WHERE code = ?").run(code);
        order.pay_method = 'later';
        pay_error = "Your order is in, but online payment isn't working right now. You can pay at pickup or delivery.";
      }
    }
    sendOrderEmails(order); // don't make the customer wait on email
    res.json({ ok: true, code, total_cents, fulfillment_label, pay_url, pay_error });
  } catch (e) {
    if (e instanceof OrderError) return res.status(400).json({ error: e.message });
    console.error('order failed', e);
    res.status(500).json({ error: 'Something went wrong. Please call or message us to order.' });
  }
});

// After paying on Square, the customer comes back here; we ask Square whether it went through.
router.get('/orders/:code/paid', async (req, res) => {
  try {
    const o = db.prepare('SELECT code, paid, square_order_id FROM orders WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (!o.paid && o.square_order_id && square.enabled()) {
      try { if (await square.isPaid(o.square_order_id)) { db.prepare('UPDATE orders SET paid = 1 WHERE code = ?').run(o.code); o.paid = 1; } }
      catch (e) { console.error(`order ${o.code}: payment check failed: ${e.message}`); }
    }
    res.json({ code: o.code, paid: !!o.paid });
  } catch (e) {
    console.error('payment status check failed', e);
    res.status(500).json({ error: 'Could not check payment' });
  }
});

module.exports = router;
