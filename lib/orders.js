// Product rules and server-side order pricing/validation.
// The browser shows a live total, but the price saved is always computed here.
const crypto = require('crypto');

// Pack rules from the bakery's pinned post.
const PRODUCTS = {
  whole:     { label: 'Whole cheesecake (10 slices, 1 flavor)', priceKey: 'price_whole' },
  mini6:     { label: 'Mini 6-pack', priceKey: 'price_mini6', slots: 6, maxFlavors: 6 },
  mini10x5:  { label: 'Mini 10-pack (up to 5 flavors)', priceKey: 'price_mini10x5', slots: 10, maxFlavors: 5 },
  mini10x10: { label: 'Mini 10-pack (up to 10 flavors)', priceKey: 'price_mini10x10', slots: 10, maxFlavors: 10 }
};

function productsWithPrices(settings) {
  const out = {};
  for (const [key, p] of Object.entries(PRODUCTS)) {
    out[key] = { ...p, price_cents: Number(settings[p.priceKey]) || 0 };
    delete out[key].priceKey;
  }
  return { products: out, gf_addon_cents: Number(settings.price_gf_addon) || 0, tax_rate: taxRate(settings) };
}
// Prices are before tax; sales tax (percent, set in the dashboard) is added on the cheesecakes, not shipping.
function taxRate(settings) { const r = Number(settings.tax_rate); return Number.isFinite(r) && r >= 0 && r < 20 ? r : 0; }
function taxOn(cents, settings) { return Math.round(cents * taxRate(settings) / 100); }

class OrderError extends Error {}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// items: [{ type, qty, flavor_id, gf } | { type, qty, picks: { [flavor_id]: count } }]
function priceItems(rawItems, flavorsById, settings) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new OrderError('Your order is empty.');
  if (rawItems.length > 30) throw new OrderError('That is a lot of items. Please message us for large orders.');
  const { products, gf_addon_cents } = productsWithPrices(settings);
  const items = [];
  let total = 0;
  for (const raw of rawItems) {
    const p = products[raw && raw.type];
    if (!p) throw new OrderError('Unknown item in your order.');
    const qty = Math.floor(Number(raw.qty) || 1);
    if (qty < 1 || qty > 20) throw new OrderError('Quantity must be between 1 and 20.');
    let unit = p.price_cents;
    let detail;
    const flavorIds = [];
    const counts = {}; // flavor name -> number of minis (or 1 for a whole), per pack
    if (raw.type === 'whole') {
      const f = flavorsById.get(Number(raw.flavor_id));
      if (!f) throw new OrderError('Please pick a flavor for each whole cheesecake.');
      const gf = !!raw.gf;
      if (gf && !f.gf) throw new OrderError(`${f.name} can't be made gluten friendly.`);
      if (gf) unit += gf_addon_cents;
      const crust = raw.crust === 'oreo' ? 'Oreo' : 'graham';
      detail = f.name + (gf ? ` · gluten friendly ${crust} crust` : '');
      flavorIds.push(f.id);
      counts[f.name] = 1;
    } else {
      const picks = raw.picks && typeof raw.picks === 'object' ? raw.picks : {};
      const parts = [];
      let count = 0;
      for (const [id, n] of Object.entries(picks)) {
        const c = Math.floor(Number(n) || 0);
        if (c <= 0) continue;
        const f = flavorsById.get(Number(id));
        if (!f) throw new OrderError('One of the flavors you picked is no longer available.');
        count += c;
        parts.push(`${f.name} (${c})`);
        flavorIds.push(f.id);
        counts[f.name] = c;
      }
      if (count !== p.slots) throw new OrderError(`${p.label}: pick exactly ${p.slots} minis (you have ${count}).`);
      if (parts.length > p.maxFlavors) throw new OrderError(`${p.label}: up to ${p.maxFlavors} different flavors.`);
      detail = parts.join(', ');
    }
    const line = unit * qty;
    total += line;
    items.push({ type: raw.type, label: p.label, detail, qty, unit_cents: unit, line_cents: line, flavor_ids: flavorIds, counts, gf: raw.type === 'whole' && !!raw.gf, crust: raw.type === 'whole' && raw.gf ? (raw.crust === 'oreo' ? 'oreo' : 'graham') : undefined });
  }
  return { items, total_cents: total };
}

function newCode() {
  // Short, readable, no look-alike characters.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(5)) s += alphabet[b % alphabet.length];
  return 'BUB-' + s;
}

module.exports = { taxOn, taxRate, PRODUCTS, productsWithPrices, priceItems, OrderError, clean, newCode };
