// Order emails. Sends to the bakery (NOTIFY_EMAIL) and, when the customer
// gave an email, a copy to them. If SMTP is not set up the order is still
// saved and the log says so, so a missing setup is easy to spot in Render.
const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (transport) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 465);
  transport = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return transport;
}

const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function orderText(o) {
  const lines = o.items.map((it) => `• ${it.qty} × ${it.label}: ${it.detail} (${money(it.line_cents)})`);
  return [
    `Order ${o.code}`,
    `${o.name} · ${o.phone}${o.email ? ' · ' + o.email : ''}`,
    `${o.fulfillment_label}`,
    '',
    ...lines,
    '',
    `Total: ${money(o.total_cents)} (including tax${o.fulfillment === 'ship' ? ' and shipping' : ''})`,
    o.pay_method === 'card' ? 'Payment: paying by card online through Square (check the dashboard for Paid)' : 'Payment: pay at pickup / delivery',
    o.notes ? `Notes: ${o.notes}` : ''
  ].filter((l) => l !== null).join('\n');
}

function orderHtml(o, heading, dashLink) {
  const rows = o.items.map((it) => `<tr><td style="padding:6px 0">${it.qty} × <b>${esc(it.label)}</b><br><span style="color:#6b5a6e">${esc(it.detail)}</span></td><td style="text-align:right;padding:6px 0">${money(it.line_cents)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#2b1630">
  <h2 style="color:#56085c;margin:0 0 4px">${esc(heading)}</h2>
  <p style="margin:0 0 14px;color:#6b5a6e">Order <b>${esc(o.code)}</b></p>
  <p style="margin:0 0 4px"><b>${esc(o.name)}</b> · ${esc(o.phone)}${o.email ? ' · ' + esc(o.email) : ''}</p>
  <p style="margin:0 0 14px">${esc(o.fulfillment_label)}</p>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #e6dce8">${rows}</table>
  <p style="border-top:1px solid #e6dce8;padding-top:10px"><b>Total: ${money(o.total_cents)}</b> <span style="color:#6b5a6e">(including tax${o.fulfillment === 'ship' ? ' and shipping' : ''})</span></p>
  <p><b>Payment:</b> ${o.pay_method === 'card' ? 'Paying by card online through Square (check the dashboard for Paid)' : 'Pay at pickup / delivery'}</p>
  ${o.notes ? `<p><b>Notes:</b> ${esc(o.notes)}</p>` : ''}
  ${dashLink ? `<p style="margin-top:18px"><a href="${esc(dashLink)}" style="background:#56085c;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-weight:bold">Open your orders dashboard</a></p>` : ''}
</div>`;
}
const siteUrl = () => (process.env.SITE_URL || '').replace(/\/$/, '');

async function sendOrderEmails(o) {
  const t = getTransport();
  const to = process.env.NOTIFY_EMAIL;
  if (!t || !to) {
    console.log(`order ${o.code} saved but NOT emailed: SMTP or NOTIFY_EMAIL not set`);
    return;
  }
  const from = process.env.MAIL_FROM || `"Batter Up Bakery Website" <${process.env.SMTP_USER}>`;
  try {
    await t.sendMail({
      from, to, replyTo: o.email || undefined,
      subject: `New cheesecake order ${o.code}: ${o.name} (${money(o.total_cents)})`,
      text: orderText(o) + (siteUrl() ? `\n\nOpen your dashboard: ${siteUrl()}/admin` : ''),
      html: orderHtml(o, 'New order from the website', siteUrl() ? siteUrl() + '/admin' : '')
    });
    console.log(`order ${o.code} emailed to ${to}`);
  } catch (e) {
    console.error(`order ${o.code} saved but NOT emailed: ${e.message}`);
  }
  if (o.email) {
    try {
      await t.sendMail({
        from, to: o.email, replyTo: to,
        subject: `We got your Batter Up order (${o.code})`,
        text: `Thanks ${o.name}! We received your order and will confirm it soon.\n\n${orderText(o)}\n\nQuestions? Call or text (207) 588-7628.`,
        html: `<p style="font-family:Arial,sans-serif">Thanks ${esc(o.name)}! We received your order and will confirm it soon.</p>${orderHtml(o, 'Your order request')}<p style="font-family:Arial,sans-serif">Questions? Call or text (207) 588-7628.</p>`
      });
    } catch (e) {
      console.error(`order ${o.code} customer copy failed: ${e.message}`);
    }
  }
}

// Wholesale invoice to a shop. Throws with a plain message if email isn't set up.
async function sendInvoiceEmail(inv, html) {
  const t = getTransport();
  if (!t) throw new Error('Email sending is not set up yet (SMTP settings missing).');
  const from = process.env.MAIL_FROM || `"Batter Up Bakery" <${process.env.SMTP_USER}>`;
  await t.sendMail({
    from, to: inv.email, replyTo: process.env.NOTIFY_EMAIL || undefined,
    subject: `Batter Up Bakery invoice #${inv.number} (${money(inv.total_cents)})`,
    text: `Invoice #${inv.number} for ${inv.customer}: ${money(inv.total_cents)}.\n` + inv.lines.map((l) => `${l.qty} ${l.kind === 'whole' ? 'whole' : 'mini'} ${l.flavor} @ ${money(l.unit_cents)}`).join('\n') + '\n\nThank you! Batter Up Bakery, (207) 588-7628',
    html
  });
  console.log(`invoice ${inv.number} emailed to ${inv.email}`);
}

// Dashboard "Send a test email" button: proves alerts reach the bakery's inbox.
function emailStatus() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL } = process.env;
  return { ready: !!(SMTP_HOST && SMTP_USER && SMTP_PASS && NOTIFY_EMAIL), to: NOTIFY_EMAIL || null, missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'NOTIFY_EMAIL'].filter((k) => !process.env[k]) };
}
async function sendTestEmail() {
  const t = getTransport(), to = process.env.NOTIFY_EMAIL;
  if (!t || !to) throw new Error('Email is not set up yet.');
  const from = process.env.MAIL_FROM || `"Batter Up Bakery Website" <${process.env.SMTP_USER}>`;
  await t.sendMail({ from, to, subject: 'Test: your website order alerts are working',
    text: `This is a test from your Batter Up Bakery website. New orders will arrive in this inbox just like this.${siteUrl() ? `\n\nDashboard: ${siteUrl()}/admin` : ''}`,
    html: `<div style="font-family:Arial,sans-serif;color:#2b1630"><h2 style="color:#56085c">Your order alerts are working</h2><p>This is a test from your Batter Up Bakery website. New orders will arrive in this inbox just like this.</p>${siteUrl() ? `<p><a href="${siteUrl()}/admin">Open your orders dashboard</a></p>` : ''}</div>` });
  console.log(`test email sent to ${to}`);
}

module.exports = { sendOrderEmails, sendInvoiceEmail, emailStatus, sendTestEmail };
