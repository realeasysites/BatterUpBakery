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
`);

const DEFAULT_SETTINGS = {
  price_whole: '5940',
  price_gf_addon: '700',
  price_mini6: '3880',
  price_mini10x5: '6480',
  price_mini10x10: '7020',
  orders_open: '1',
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

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, getSettings, setSetting, DATA_DIR };
