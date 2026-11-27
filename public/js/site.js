// Shared site script: mobile menu, live flavors/prices/dates from the dashboard.
(function () {
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // "2026-12-02" -> "Tue, Dec 2"
  const short = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

  // Mobile menu
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); } });
  }
  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

  // Traffic: remember where this visit came from (Facebook, Google, a QR code...) for the
  // whole visit, log each page view, and count taps on call / text / Messenger / Facebook.
  // Visit any page with #notrack once on a phone to stop counting yourself.
  try {
    if (location.hash === '#notrack') localStorage.setItem('bub-notrack', '1');
    if (location.hash === '#track') localStorage.removeItem('bub-notrack');
  } catch (e) {}
  const tracking = (() => { try { return !localStorage.getItem('bub-notrack'); } catch (e) { return true; } })();
  let visit = null;
  try { visit = JSON.parse(sessionStorage.getItem('bub-visit') || 'null'); } catch (e) {}
  const landing = !visit;
  if (!visit) {
    const q = new URLSearchParams(location.search);
    visit = { utm: q.get('utm_source') || q.get('src') || '', campaign: q.get('utm_campaign') || '', fbclid: q.get('fbclid') ? 1 : 0, gclid: q.get('gclid') ? 1 : 0, ref: document.referrer || '' };
    try { sessionStorage.setItem('bub-visit', JSON.stringify(visit)); } catch (e) {}
  }
  const send = (data) => {
    if (!tracking) return;
    const body = JSON.stringify(Object.assign({}, visit, data));
    if (navigator.sendBeacon) navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }));
    else fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  window.BUB_VISIT = visit;
  send({ type: 'view', path: location.pathname, landing: landing ? 1 : 0 });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const h = a.getAttribute('href') || '';
    const type = h.startsWith('tel:') ? 'call' : h.startsWith('sms:') ? 'text' : h.startsWith('mailto:') ? 'email' : /m\.me\/|messenger\.com/.test(h) ? 'messenger' : /facebook\.com/.test(h) ? 'facebook' : /^\/order/.test(h) ? 'order_start' : '';
    if (type) send({ type });
  });

  const menu = fetch('/api/menu').then((r) => r.json());
  const stops = fetch('/api/stops').then((r) => r.json());
  window.BUB = { money, esc, menu, stops, short };

  menu.then((m) => {
    // Prices
    document.querySelectorAll('[data-price]').forEach((el) => {
      const p = m.products[el.dataset.price];
      if (p) el.innerHTML = money(p.price_cents) + (m.tax_rate ? ' <small style="font-size:.5em;font-weight:600">+ tax</small>' : '');
    });
    document.querySelectorAll('[data-ship-price]').forEach((el) => (el.textContent = money(m.ship_cents || 0)));
    document.querySelectorAll('[data-gf-price]').forEach((el) => (el.textContent = (m.gf_addon_cents / 100).toFixed(2)));
    document.querySelectorAll('[data-flavor-count]').forEach((el) => (el.textContent = m.flavors.length));

    // Dates for this week's cycle
    const c = m.cycle;
    document.querySelectorAll('[data-cutoff]').forEach((el) => (el.textContent = c.cutoff.label));
    const when = {
      route: `${short(c.route.Tuesday.date)} or ${short(c.route.Wednesday.date)}`,
      pickup: `${short(c.pickup[0].date)} to ${short(c.pickup[3].date)}`,
      ship: `Ships ${short(c.ship.date)}`
    };
    document.querySelectorAll('[data-when]').forEach((el) => (el.textContent = when[el.dataset.when]));

    // Top notice bar
    const notice = document.getElementById('notice');
    if (notice) {
      if (!m.orders_open) notice.innerHTML = 'Online ordering is paused right now. <b>Message us on Facebook</b> or call (207) 588-7628.';
      else if (m.announcement) notice.innerHTML = esc(m.announcement);
      else notice.innerHTML = `Order by <b>${esc(c.cutoff.label)}</b> for delivery, pickup or shipping. It's yours to enjoy the following week.`;
    }

    // Flavor board
    const board = document.getElementById('flavor-board');
    if (board && m.flavors.length) {
      const tags = (f) => `${f.gf ? ' <span class="tag" title="Can be made gluten friendly as a whole cheesecake">GF</span>' : ''}${f.seasonal ? ' <span class="tag season">Seasonal</span>' : ''}`;
      const withPhoto = m.flavors.filter((f) => f.photo);
      const rest = m.flavors.filter((f) => !f.photo);
      board.innerHTML =
        (withPhoto.length ? `<div class="flavor-photos${withPhoto.length > 8 ? ' collapsed' : ''}">${withPhoto.map((f) => `<figure class="fcard"><img src="${esc(f.photo)}" alt="${esc(f.name)} mini cheesecakes" loading="lazy"><figcaption>${esc(f.name)}${tags(f)}</figcaption></figure>`).join('')}</div>` +
          (withPhoto.length > 8 ? `<p class="center show-all-wrap"><button type="button" class="btn ghost show-all">See all ${withPhoto.length} flavor photos</button></p>` : '') : '') +
        (rest.length ? `${withPhoto.length ? '<h3 class="more-flavors">More flavors</h3>' : ''}<div class="chips">${rest.map((f) => `<span class="chip">${esc(f.name)}${tags(f)}</span>`).join('')}</div>` : '');
      const all = board.querySelector('.show-all');
      if (all) all.addEventListener('click', () => { board.querySelector('.flavor-photos').classList.remove('collapsed'); all.parentElement.remove(); });
    }
  }).catch(() => {});

  stops.then((s) => {
    document.querySelectorAll('[data-stop-count]').forEach((el) => (el.textContent = s.stops.length));
  }).catch(() => {});
})();
