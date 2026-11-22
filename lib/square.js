// Square online checkout (hosted payment links). The access token stays on the server
// (Render env SQUARE_ACCESS_TOKEN); customers pay on Square's own secure page and the
// money goes straight into the bakery's Square account.
// Turned on only when SQUARE_PAYMENTS=1 (after a $1 live test).
const crypto = require('crypto');

const VERSION = '2025-10-16';
function base() {
  if (process.env.SQUARE_BASE_URL) return process.env.SQUARE_BASE_URL;
  return process.env.SQUARE_ENVIRONMENT === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}
// Customers see "Pay now by card" only when Square is connected AND the owner has the
// "Card payments" switch on in her dashboard (Prices & settings). Off by default.
function enabled() {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return false;
  return require('../db').getSettings().card_payments === '1';
}
async function call(method, path, body) {
  const r = await fetch(base() + path, {
    method,
    headers: { 'Square-Version': VERSION, Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.errors || []).map((e) => e.detail || e.code).join('; ') || `Square error ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// Build a Square payment link for a saved website order. Returns { url, orderId, linkId }.
async function createPaymentLink(order, siteUrl) {
  const line_items = order.items.map((it) => ({
    name: `${it.label}: ${it.detail}`.slice(0, 500),
    quantity: String(it.qty),
    base_price_money: { amount: it.unit_cents, currency: 'USD' }
  }));
  const digits = String(order.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const pre = {};
  if (order.email) pre.buyer_email = order.email;
  if (digits.length === 10) pre.buyer_phone_number = '+1' + digits;
  const body = {
    idempotency_key: crypto.randomUUID(),
    order: {
      location_id: process.env.SQUARE_LOCATION_ID,
      reference_id: order.code,
      line_items
    },
    checkout_options: {
      redirect_url: `${siteUrl}/order?paid=${encodeURIComponent(order.code)}`,
      ask_for_shipping_address: false
    },
    payment_note: `Batter Up website order ${order.code}`
  };
  if (Object.keys(pre).length) body.pre_populated_data = pre;
  const d = await call('POST', '/v2/online-checkout/payment-links', body);
  const link = d.payment_link || {};
  return { url: link.url || link.long_url, orderId: link.order_id, linkId: link.id };
}

// Paid when the Square order has nothing left to pay (or is completed).
async function isPaid(squareOrderId) {
  const d = await call('GET', `/v2/orders/${encodeURIComponent(squareOrderId)}`);
  const o = d.order || {};
  const due = o.net_amount_due_money ? o.net_amount_due_money.amount : null;
  const tendered = Array.isArray(o.tenders) && o.tenders.length > 0;
  return o.state === 'COMPLETED' || (tendered && due === 0);
}

// $1 test link for the owner/Kivvy to prove real payments reach the bakery's Square.
// Works whenever the token and location are set, even before SQUARE_PAYMENTS is turned on.
function configured() { return !!process.env.SQUARE_ACCESS_TOKEN && !!process.env.SQUARE_LOCATION_ID; }
async function createTestLink(siteUrl) {
  const d = await call('POST', '/v2/online-checkout/payment-links', {
    idempotency_key: crypto.randomUUID(),
    quick_pay: { name: 'Website payment test (refund me)', price_money: { amount: 100, currency: 'USD' }, location_id: process.env.SQUARE_LOCATION_ID },
    checkout_options: { redirect_url: `${siteUrl}/admin` }
  });
  const link = d.payment_link || {};
  return { url: link.url || link.long_url, orderId: link.order_id };
}

// Card payments in the last day (used to confirm the $1 test reached her Square).
async function recentPayments() {
  const begin = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const d = await call('GET', `/v2/payments?location_id=${encodeURIComponent(process.env.SQUARE_LOCATION_ID)}&begin_time=${encodeURIComponent(begin)}&sort_order=DESC&limit=20`);
  return (d.payments || []).map((p) => ({ amount_cents: p.amount_money && p.amount_money.amount, status: p.status, created_at: p.created_at, card: p.card_details && p.card_details.card && p.card_details.card.last_4, refunded_cents: p.refunded_money ? p.refunded_money.amount : 0 }));
}

module.exports = { recentPayments, enabled, configured, createPaymentLink, isPaid, createTestLink };
