// SQLite setup, schema and first-run seed data (flavors, route stops, prices).
// Seed data only fills an empty database: anything the owner changes in the
// dashboard is never overwritten on deploy.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'batterup.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS flavors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gf INTEGER NOT NULL DEFAULT 0,        -- 1 = can be made gluten friendly (whole only)
  seasonal INTEGER NOT NULL DEFAULT 0,  -- 1 = shows a "Seasonal" tag
  active INTEGER NOT NULL DEFAULT 1,    -- 0 = hidden from the site and order form
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  town TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day IN ('Tuesday','Wednesday')),
  route INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  fulfillment TEXT NOT NULL,            -- pickup | route | ship
  fulfill_date TEXT,                    -- YYYY-MM-DD the order is for
  stop_id INTEGER,
  stop_label TEXT,                      -- copied so old orders still read right if a stop is deleted
  ship_address TEXT,
  items_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new'    -- new | confirmed | ready | done | cancelled
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(fulfill_date);

-- Cheesecake Hunt giveaway entries (one per phone number).
CREATE TABLE IF NOT EXISTS hunt_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL UNIQUE,      -- digits only, for one-entry-per-phone
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  winner INTEGER NOT NULL DEFAULT 0
);

-- Wholesale: shops that buy for resale, and the weekly invoices sent to them.
CREATE TABLE IF NOT EXISTS ws_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  town TEXT,
  email TEXT,
  price_mini_cents INTEGER NOT NULL DEFAULT 0,
  price_whole_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ws_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES ws_customers(id) ON DELETE CASCADE,
  invoice_date TEXT NOT NULL,            -- YYYY-MM-DD
  lines_json TEXT NOT NULL,              -- [{flavor, kind: mini|whole, qty, unit_cents}]
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | paid
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ws_inv_date ON ws_invoices(invoice_date);
`);

// Columns added after launch prep: online card payments through Square.
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
for (const [col, type] of [['pay_method', "TEXT NOT NULL DEFAULT 'later'"], ['square_order_id', 'TEXT'], ['pay_url', 'TEXT'], ['paid', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!orderCols.includes(col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${type}`);
}

// Route shops that serve cheesecake by the slice instead of minis (Loreen, Nov 22).
if (!db.prepare('PRAGMA table_info(stops)').all().some((c) => c.name === 'slices')) {
  db.exec('ALTER TABLE stops ADD COLUMN slices INTEGER NOT NULL DEFAULT 0');
}

// Wholesale: shop addresses and payment tracking (method, check number, date paid).
const wsCustCols = db.prepare('PRAGMA table_info(ws_customers)').all().map((c) => c.name);
if (!wsCustCols.includes('address')) db.exec('ALTER TABLE ws_customers ADD COLUMN address TEXT');
const wsInvCols = db.prepare('PRAGMA table_info(ws_invoices)').all().map((c) => c.name);
for (const [col, type] of [['pay_method', 'TEXT'], ['check_no', 'TEXT'], ['paid_on', 'TEXT']]) {
  if (!wsInvCols.includes(col)) db.exec(`ALTER TABLE ws_invoices ADD COLUMN ${col} ${type}`);
}

const DEFAULT_SETTINGS = {
  card_payments: '0',
  tax_rate: '8',
  card_only: '0',
  price_ship: '1995',
  site_public: '0',
  price_whole: '5940',
  price_gf_addon: '700',
  price_mini6: '3880',
  price_mini10x5: '6480',
  price_mini10x10: '7020',
  orders_open: '1',
  hunt_on: '1',
  hunt_start: '2026-11-27',             // first day it shows to the public (launch day)
  hunt_end: '2026-12-06',               // last day to enter (Maine time, through 11:59 PM)
  hunt_prize: 'a 10-flavor mini variety pack',
  hunt_winners: '2',
  announcement: ''
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

// Flavor list from the bakery's pinned Facebook post (Nov 2026). GF = gluten friendly as a whole.
const SEED_FLAVORS = [
  ['7 Layer', 1], ['Apple Crisp', 0], ['Banana Cream', 0], ['Brownie Bash', 0], ['Butterfinger', 1],
  ['Butterscotch', 0], ['Caramello', 1], ['Cherry Garcia', 1], ['Classic Cherry', 1], ['Coconut Cream', 1],
  ['Coffee Oreo', 0], ['Coffee Toffee', 1], ['Confetti', 0], ['Cookie Butter', 0], ['Cookies & Cream', 0],
  ['Cookie Dough', 0], ['Java Chip', 1], ['Key Lime', 1], ['Lemon with Blueberries', 1], ['Lemon with Raspberries', 1],
  ['Maple Walnut', 1], ['Mint Chocolate', 1], ['Mocha Chip', 1], ['Peanut Butter Cup', 1], ['Pistachio', 0],
  ['Plain', 1], ['Pumpkin', 1], ['Pumpkin Chip', 1], ['Snickerdoodle', 0], ['Snickers', 1],
  ['Strawberry Crunch', 0], ['Sugar Cookie', 0], ['Tiramisu', 0], ['Toffee Salted Caramel', 1], ['Turtle', 1],
  ['Twix', 0]
];
if (db.prepare('SELECT COUNT(*) n FROM flavors').get().n === 0) {
  const ins = db.prepare('INSERT INTO flavors (name, gf, sort) VALUES (?, ?, ?)');
  db.transaction(() => SEED_FLAVORS.forEach(([n, gf], i) => ins.run(n, gf, i)))();
}

// Delivery route stops from the pinned post. [name, town, day, route]
const SEED_STOPS = [
  ["Emery's Meat & Produce", 'Gardiner', 'Tuesday', 1], ['The Depot Sports Pub', 'Gardiner', 'Tuesday', 1],
  ["Amie's Place", 'Litchfield', 'Tuesday', 1], ["Doolin's Pub", 'Litchfield', 'Tuesday', 1],
  ["Foggy's Pub", 'Palmyra', 'Tuesday', 1], ['Rusty Lantern Market', 'Lisbon Falls', 'Tuesday', 1],
  ["Pat's Pizza", 'Brunswick', 'Tuesday', 1], ['Rusty Lantern Market, Cooks Corner', 'Brunswick', 'Tuesday', 1],
  ['Rusty Lantern Market', 'Topsham', 'Tuesday', 1], ['Fairwinds Farm', 'Topsham', 'Tuesday', 1],
  ['Bowdoinham Country Store', 'Bowdoinham', 'Tuesday', 1], ["Charleen's", 'Richmond', 'Tuesday', 1],
  ['Main Street Market', 'Sabattus', 'Tuesday', 2], ['Rusty Lantern Market', 'Sabattus', 'Tuesday', 2],
  ["Bourque's Market", 'Lewiston', 'Tuesday', 2], ["Blackie's Farm Fresh Produce", 'Auburn', 'Tuesday', 2],
  ['Crossroads', 'Auburn', 'Tuesday', 2], ['Links Variety', 'New Gloucester', 'Tuesday', 2],
  ["Bob's Seafood", 'Windham', 'Tuesday', 2], ['Chipman Farm', 'Raymond & Gray', 'Tuesday', 2],
  ['The Good Life Market', 'Raymond', 'Tuesday', 2], ["Pat's Pizza", 'Windham', 'Tuesday', 2],
  ['TNT Convenience Store', 'Gorham', 'Tuesday', 2], ['Smoked', 'Windham', 'Tuesday', 2],
  ['Buxton Mini Mart', 'Buxton', 'Tuesday', 2], ['Sleepers Supermarket Ace Hardware', 'Limington', 'Tuesday', 2],
  ['The Liberal Cup', 'Hallowell', 'Wednesday', 1], ['Bagel Mainea', 'Augusta', 'Wednesday', 1],
  ['Twins Country Store', 'Augusta', 'Wednesday', 1], ['Rusty Lantern Market, Denali Way', 'Augusta', 'Wednesday', 1],
  ["Joseph's Market", 'Waterville', 'Wednesday', 1], ['Rusty Lantern Market, Main Street', 'Waterville', 'Wednesday', 1],
  ['Rusty Lantern Market, River Road', 'Waterville', 'Wednesday', 1], ["Shelby's Deli", 'Oakland', 'Wednesday', 1],
  ['Buddies Groceries', 'Oakland', 'Wednesday', 1], ['Tri Pond Variety', 'Smithfield', 'Wednesday', 1],
  ["Christy's Country Store", 'Belgrade', 'Wednesday', 1], ['Rusty Lantern Market, Civic Center Drive', 'Augusta', 'Wednesday', 1],
  ["Mulligan's / Nouria", 'Manchester', 'Wednesday', 1], ['Manchester Meats', 'Manchester', 'Wednesday', 1],
  ['Tavern on the Hill 305', 'Winthrop', 'Wednesday', 1],
  ["Cobbie's Corner Store", 'Wayne', 'Wednesday', 2], ['Rusty Lantern Market', 'Livermore Falls', 'Wednesday', 2],
  ['Rusty Lantern Markets (both locations)', 'Turner', 'Wednesday', 2], ['Rusty Lantern Market', 'Oxford', 'Wednesday', 2],
  ['Rusty Lantern Market', 'West Paris', 'Wednesday', 2], ['Rusty Lantern Market', 'Bethel', 'Wednesday', 2],
  ['Bow Street Market', 'Freeport', 'Wednesday', 3], ["Antonia's Pizzeria", 'Freeport', 'Wednesday', 3],
  ['North Yarmouth Variety', 'North Yarmouth', 'Wednesday', 3], ['Cumberland Foodstop', 'Cumberland', 'Wednesday', 3],
  ['Rusty Lantern Market', 'Cumberland', 'Wednesday', 3], ['Smoked', 'Portland', 'Wednesday', 3],
  ['The Quality Shop', 'Portland', 'Wednesday', 3], ["Pat's Meat Market", 'Portland', 'Wednesday', 3],
  ['Pavilion Grill, Maine Med', 'Portland', 'Wednesday', 3], ['Rusty Lantern Market, Congress Street', 'Portland', 'Wednesday', 3],
  ['Rusty Lantern, Broadway', 'South Portland', 'Wednesday', 3], ["Willow's Pizza", 'South Portland', 'Wednesday', 3],
  ["Al's of Scarborough", 'Scarborough', 'Wednesday', 3], ['Duck Pond Variety', 'Westbrook', 'Wednesday', 3]
];
if (db.prepare('SELECT COUNT(*) n FROM stops').get().n === 0) {
  const ins = db.prepare('INSERT INTO stops (name, town, day, route, sort) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => SEED_STOPS.forEach(([n, t, d, r], i) => ins.run(n, t, d, r, i)))();
}

// Sample wholesale data so the owner can try invoicing before entering her real shops.
// Prices are placeholders. "Clear sample data" in the dashboard removes all of it.
if (process.env.WHOLESALE_ENABLED === '1' && db.prepare('SELECT COUNT(*) n FROM ws_customers').get().n === 0 && !db.prepare("SELECT value FROM settings WHERE key='ws_demo_seeded'").get()) {
  const shops = db.prepare('SELECT name, town FROM stops ORDER BY sort LIMIT 10').all();
  const flavors = db.prepare('SELECT name FROM flavors WHERE active = 1 ORDER BY sort').all().map((f) => f.name);
  const insC = db.prepare('INSERT INTO ws_customers (name, town, price_mini_cents, price_whole_cents, demo) VALUES (?, ?, 350, 4500, 1)');
  const insI = db.prepare('INSERT INTO ws_invoices (number, customer_id, invoice_date, lines_json, total_cents, status, demo) VALUES (?, ?, ?, ?, ?, ?, 1)');
  const today = new Date();
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7), 12));
  db.transaction(() => {
    let num = 1001;
    shops.forEach((s, i) => {
      const cid = insC.run(s.name, s.town).lastInsertRowid;
      // Three past weeks of standing orders for the first 8 shops.
      if (i < 8) for (let w = 3; w >= 1; w--) {
        const d = new Date(monday); d.setUTCDate(d.getUTCDate() - 7 * w + 1 + (i % 2)); // Tue or Wed
        const lines = [{ flavor: 'Cheesecake minis', kind: 'mini', qty: 18 + (i % 4) * 6, unit_cents: 350 }];
        if (i % 3 === 0) lines.push({ flavor: 'Whole cheesecakes', kind: 'whole', qty: 1 + (i % 2), unit_cents: 4500 });
        const total = lines.reduce((t, l) => t + l.qty * l.unit_cents, 0);
        insI.run(num++, cid, d.toISOString().slice(0, 10), JSON.stringify(lines), total, w > 1 ? 'paid' : 'sent');
      }
    });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_demo_seeded', '1')").run();
  })();
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// One time: mark the shops that serve slices, not minis (editable after in Shops & route).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'slices_marked'").get() && db.prepare('SELECT COUNT(*) n FROM stops').get().n) {
  db.prepare(`UPDATE stops SET slices = 1 WHERE name LIKE 'Doolin%' OR name LIKE '%Depot%' OR name LIKE 'Tavern%' OR name LIKE '%Liberal%' OR name LIKE 'Bob%' OR name LIKE 'Foggy%'`).run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('slices_marked', '1')").run();
}

module.exports = { db, getSettings, setSetting, DATA_DIR };
