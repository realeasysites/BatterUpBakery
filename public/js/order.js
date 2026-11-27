// Order builder: pick a size, choose flavors, add to order, choose pickup/route/ship, place order.
(function () {
  const { money, esc, menu, stops, short } = window.BUB;
  const $ = (id) => document.getElementById(id);
  const builder = $('builder');
  const state = { pack: 'whole', way: 'route', pay: 'card', cart: [], whole: { flavor: null, gf: false, crust: 'graham' }, picks: {} };
  let M = null; // menu data
  let flavorsById = new Map();

  try { const saved = JSON.parse(sessionStorage.getItem('bub-cart') || '[]'); if (Array.isArray(saved)) state.cart = saved; } catch (e) {}
  const save = () => { try { sessionStorage.setItem('bub-cart', JSON.stringify(state.cart)); } catch (e) {} };

  const urlPack = new URLSearchParams(location.search).get('pack');

  // ---------- size picker ----------
  document.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => {
    state.pack = b.dataset.pack;
    state.picks = {};
    state.whole = { flavor: null, gf: false, crust: 'graham' };
    document.querySelectorAll('[data-pack]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderBuilder();
  }));

  function unitPrice(item) {
    const p = M.products[item.type];
    return p.price_cents + (item.type === 'whole' && item.gf ? M.gf_addon_cents : 0);
  }

  // ---------- builder ----------
  function renderBuilder() {
    if (!M) return;
    const p = M.products[state.pack];
    if (state.pack === 'whole') {
      builder.innerHTML = `
        <label>Choose a flavor</label>
        <div class="flavor-pick" role="radiogroup" aria-label="Flavor">
          ${M.flavors.map((f) => `<button type="button" role="radio" aria-checked="${state.whole.flavor === f.id}" class="fp radio ${state.whole.flavor === f.id ? 'on' : ''}" data-f="${f.id}">${esc(f.name)}${f.gf ? ' <span class="tag">GF</span>' : ''}${f.seasonal ? ' <span class="tag season">Seasonal</span>' : ''}</button>`).join('')}
        </div>
        <label class="check"><input type="checkbox" id="gf" ${state.whole.gf ? 'checked' : ''} ${gfAllowed() ? '' : 'disabled'}> Gluten-friendly crust (+${money(M.gf_addon_cents)})</label>
        <div class="crust-pick" id="crust-pick" ${state.whole.gf && gfAllowed() ? '' : 'hidden'} role="radiogroup" aria-label="Gluten-friendly crust">
          <label class="check" style="margin:.2rem 1rem .2rem 0;display:inline-flex"><input type="radio" name="crust" value="graham" ${state.whole.crust !== 'oreo' ? 'checked' : ''}> Graham crust</label>
          <label class="check" style="margin:.2rem 0;display:inline-flex"><input type="radio" name="crust" value="oreo" ${state.whole.crust === 'oreo' ? 'checked' : ''}> Oreo crust</label>
        </div>
        <p class="hint" id="gf-hint">${gfHint()}</p>
        ${addRow(p)}`;
      builder.querySelectorAll('.fp').forEach((b) => b.addEventListener('click', () => {
        state.whole.flavor = Number(b.dataset.f);
        if (!gfAllowed()) state.whole.gf = false;
        const scroll = builder.querySelector('.flavor-pick').scrollTop;
        renderBuilder();
        builder.querySelector('.flavor-pick').scrollTop = scroll;
      }));
      $('gf').addEventListener('change', (e) => { state.whole.gf = e.target.checked; $('crust-pick').hidden = !e.target.checked; updateAdd(); });
      builder.querySelectorAll('[name=crust]').forEach((r) => r.addEventListener('change', () => { state.whole.crust = r.value; }));
    } else {
      builder.innerHTML = `
        <div class="progress"><span id="pick-count"></span><span class="bar"><i id="pick-bar"></i></span><span id="pick-flavors"></span></div>
        <div class="flavor-pick" aria-label="Flavors">
          ${M.flavors.map((f) => `<div class="fp" data-f="${f.id}"><span>${esc(f.name)}</span><span class="ctr"><button type="button" data-d="-1" aria-label="One less ${esc(f.name)}">−</button><output>0</output><button type="button" data-d="1" aria-label="One more ${esc(f.name)}">+</button></span></div>`).join('')}
        </div>
        <p class="hint">Gluten friendly isn't available in the minis.</p>
        ${addRow(p)}`;
      builder.querySelectorAll('.fp button').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.closest('.fp').dataset.f);
        const next = (state.picks[id] || 0) + Number(b.dataset.d);
        if (next <= 0) delete state.picks[id]; else state.picks[id] = next;
        updateMini();
      }));
      updateMini();
    }
    $('add').addEventListener('click', addToCart);
    updateAdd();
  }

  function addRow(p) {
    return `<div class="add-row">
      <div class="qty"><label for="qty">How many</label><input id="qty" type="number" min="1" max="20" value="1" inputmode="numeric"></div>
      <button type="button" class="btn" id="add">Add to order</button>
      <span class="muted" id="add-note"></span>
    </div>`;
  }

  function gfAllowed() {
    const f = flavorsById.get(state.whole.flavor);
    return !!(f && f.gf);
  }
  function gfHint() {
    const f = flavorsById.get(state.whole.flavor);
    if (!f) return 'Pick a flavor. Flavors marked GF can be made with a gluten-friendly graham or Oreo crust.';
    return f.gf ? `${esc(f.name)} can be made gluten friendly, with a graham or Oreo crust.` : `${esc(f.name)} isn't available gluten friendly.`;
  }

  function miniCounts() {
    const p = M.products[state.pack];
    const count = Object.values(state.picks).reduce((a, b) => a + b, 0);
    const distinct = Object.keys(state.picks).length;
    return { p, count, distinct };
  }
  function updateMini() {
    const { p, count, distinct } = miniCounts();
    $('pick-count').textContent = `${count} of ${p.slots} minis`;
    $('pick-bar').style.width = (count / p.slots) * 100 + '%';
    $('pick-flavors').textContent = `${distinct} of up to ${p.maxFlavors} flavors`;
    builder.querySelectorAll('.fp').forEach((row) => {
      const id = Number(row.dataset.f);
      const n = state.picks[id] || 0;
      row.querySelector('output').textContent = n;
      row.classList.toggle('on', n > 0);
      row.querySelector('[data-d="-1"]').disabled = n === 0;
      row.querySelector('[data-d="1"]').disabled = count >= p.slots || (n === 0 && distinct >= p.maxFlavors);
    });
    updateAdd();
  }

  function updateAdd() {
    const add = $('add');
    const note = $('add-note');
    if (!add) return;
    if (state.pack === 'whole') {
      add.disabled = !state.whole.flavor;
      note.textContent = state.whole.flavor ? money(unitPrice({ type: 'whole', gf: state.whole.gf })) + ' each' : 'Pick a flavor first';
    } else {
      const { p, count } = miniCounts();
      add.disabled = count !== p.slots;
      note.textContent = count === p.slots ? money(p.price_cents) + ' each' : `Pick ${p.slots - count} more`;
    }
  }

  function addToCart() {
    const qty = Math.min(20, Math.max(1, Math.floor(Number($('qty').value) || 1)));
    let item;
    if (state.pack === 'whole') {
      if (!state.whole.flavor) return;
      item = { type: 'whole', qty, flavor_id: state.whole.flavor, gf: state.whole.gf && gfAllowed(), crust: state.whole.crust === 'oreo' ? 'oreo' : 'graham' };
      state.whole = { flavor: null, gf: false, crust: 'graham' };
    } else {
      item = { type: state.pack, qty, picks: { ...state.picks } };
      state.picks = {};
    }
    state.cart.push(item);
    save();
    renderBuilder();
    renderCart();
    if (window.innerWidth < 1000) document.querySelector('.cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- cart ----------
  function describe(item) {
    if (item.type === 'whole') {
      const f = flavorsById.get(item.flavor_id);
      return (f ? f.name : 'Flavor no longer available') + (item.gf ? ` · gluten friendly ${item.crust === 'oreo' ? 'Oreo' : 'graham'} crust` : '');
    }
    return Object.entries(item.picks).map(([id, n]) => `${(flavorsById.get(Number(id)) || { name: "?" }).name} (${n})`).join(', ');
  }
  function renderCart() {
    if (!M) return;
    // Drop anything whose flavors were removed since it was saved.
    state.cart = state.cart.filter((it) => M.products[it.type] && (it.type === 'whole' ? flavorsById.has(it.flavor_id) : Object.keys(it.picks || {}).every((id) => flavorsById.has(Number(id)))));
    const ul = $('cart-items');
    ul.innerHTML = state.cart.map((it, i) => `<li><b>${it.qty} × ${esc(M.products[it.type].label)}</b><span>${money(unitPrice(it) * it.qty)}</span><small>${esc(describe(it))}</small><button class="rm" data-i="${i}">Remove</button></li>`).join('');
    ul.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { state.cart.splice(Number(b.dataset.i), 1); save(); renderCart(); }));
    $('cart-empty').hidden = state.cart.length > 0;
    const sub = state.cart.reduce((t, it) => t + unitPrice(it) * it.qty, 0);
    const ship = state.way === 'ship' && state.cart.length ? (M.ship_cents || 0) : 0;
    const tax = Math.round(sub * (M.tax_rate || 0) / 100);
    $('sub-line').hidden = !sub; $('sub-amt').textContent = money(sub);
    $('tax-line').hidden = !sub; $('tax-amt').textContent = money(tax); $('tax-label').textContent = `Sales tax (${M.tax_rate || 0}%)`;
    $('ship-line').hidden = !ship; $('ship-amt').textContent = money(ship);
    $('cart-total').textContent = money(sub + tax + ship);
    $('place').disabled = state.cart.length === 0 || !M.orders_open;
    if (typeof shipCheck === 'function' && state.way === 'ship') shipCheck();
  }

  // ---------- fulfillment ----------
  document.querySelectorAll('[data-way]').forEach((b) => b.addEventListener('click', () => {
    state.way = b.dataset.way;
    document.querySelectorAll('[data-way]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('[data-show]').forEach((el) => (el.hidden = el.dataset.show !== state.way));
    shipCheck();
    updatePayUI();
    renderCart();
  }));
  // Pay now by card (Square) or pay later.
  document.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
    state.pay = b.dataset.pay;
    document.querySelectorAll('[data-pay]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    updatePayUI();
  }));
  function updatePayUI() {
    if (!M) return;
    const box = $('pay-choice');
    if (M.card_only) state.pay = 'card';
    box.hidden = !M.card_payments || !!M.card_only;
    $('pay-other').hidden = !(M.card_payments && M.card_only);
    $('pay-hint').textContent = state.pay === 'card' ? "You'll go to Square's secure checkout to pay, then come right back here." : 'Pay with cash or card when you get your order.';
    const placeBtn = $('place');
    if (!placeBtn.dataset.busy) placeBtn.textContent = M.card_payments && state.pay === 'card' ? 'Continue to payment' : 'Place order';
  }
  function shipCheck() {
    const bad = state.way === 'ship' && state.cart.some((it) => it.type === 'whole');
    showErr(bad ? "Whole cheesecakes can't be shipped. Choose pickup or a route meet-up, or remove the whole cheesecake to ship your mini packs." : '');
  }

  function setupFulfillment(stopList) {
    const c = M.cycle;
    const sel = $('stop');
    for (const d of ['Tuesday', 'Wednesday']) {
      const g = document.createElement('optgroup');
      g.label = `${d} delivery (${short(c.route[d].date)})`;
      stopList.filter((s) => s.day === d).sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name)).forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = `${s.town}: ${s.name}`; o.dataset.day = d;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    sel.addEventListener('change', () => {
      const o = sel.selectedOptions[0];
      $('stop-hint').textContent = o && o.value
        ? `We'll meet you at ${o.textContent.split(': ')[1]} on ${c.route[o.dataset.day].label}. We'll confirm the time with you.`
        : 'We\'ll meet you there on delivery day and confirm the time.';
    });
    $('pickup-day').innerHTML = c.pickup.map((d) => `<option value="${d.date}">${esc(d.label)}, 9 AM to 5 PM</option>`).join('');
    $('ship-hint').textContent = `Mini packs only, shipped without a gift box (whole cheesecakes can't be shipped). No PO boxes. Ships out ${c.ship.label} by UPS (24 to 48 hours in Maine). Flat ${money(M.ship_cents || 0)} shipping.`;
    const tue = new Date(c.route.Tuesday.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
    $('cycle-h').textContent = `Please order by ${c.cutoff.label.replace(' at ', ' @ ')}`;
    $('cycle-line').innerHTML = `to receive your cheesecake the week of <b>${esc(tue)}</b>. Choose how and what day below. We'll confirm your order by phone, text or email.`;
  }

  // ---------- place order ----------
  function showErr(msg) { const e = $('order-err'); e.textContent = msg; e.hidden = !msg; }
  $('place').addEventListener('click', async () => {
    showErr('');
    const body = {
      items: state.cart,
      fulfillment: state.way,
      stop_id: $('stop').value,
      pickup_date: $('pickup-day').value,
      ship_address: `${$('ship-street').value.trim()}, ${$('ship-town').value.trim()}, ME ${$('ship-zip').value.trim()}`,
      name: $('name').value, phone: $('phone').value, email: $('email').value, notes: $('notes').value,
      website: $('website').value,
      pay: M.card_payments ? state.pay : 'later'
    };
    if (state.way === 'route' && !body.stop_id) return showErr('Please choose a meet-up spot on our route.');
    if (state.way === 'ship' && state.cart.some((it) => it.type === 'whole')) return showErr("Whole cheesecakes can't be shipped. Choose pickup or a route meet-up, or remove the whole cheesecake to ship your mini packs.");
    if (state.way === 'ship') {
      if ($('ship-street').value.trim().length < 4) return showErr('Please enter your street address.');
      if (!$('ship-town').value.trim()) return showErr('Please enter your town.');
      if (!/^0[34]\d{3}$/.test($('ship-zip').value.trim())) return showErr('Please enter a 5-digit Maine ZIP code.');
    }
    if (!body.name.trim()) return showErr('Please enter your name.');
    if (body.phone.replace(/\D/g, '').length < 10) return showErr('Please enter a phone number we can reach you at.');
    const btn = $('place');
    btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = body.pay === 'card' ? 'Opening secure checkout…' : 'Placing order…';
    try {
      body.visit = window.BUB_VISIT || null;
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Something went wrong.');
      state.cart = []; save();
      if (data.pay_url) { window.location.href = data.pay_url; return; }   // off to Square's checkout
      $('order-app').hidden = true;
      $('done-code').textContent = data.code;
      $('done-line').textContent = `${data.fulfillment_label}. Total ${money(data.total_cents)}${state.way === 'ship' ? ' including shipping' : ''}.${data.pay_error ? ' ' + data.pay_error : ''}`;
      $('order-done').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showErr(e.message);
      btn.disabled = false; delete btn.dataset.busy; updatePayUI();
    }
  });

  // Back from Square's checkout: confirm the payment went through.
  async function showPaidReturn(code) {
    $('order-app').hidden = true; $('order-done').hidden = false;
    $('done-code').textContent = code;
    $('done-line').textContent = 'Checking your payment…';
    let paid = false;
    for (let i = 0; i < 4 && !paid; i++) {
      try { paid = (await (await fetch('/api/orders/' + encodeURIComponent(code) + '/paid')).json()).paid; } catch (e) {}
      if (!paid) await new Promise((r) => setTimeout(r, 1500));
    }
    $('done-line').textContent = paid ? 'Payment received. Thank you! We\'ll see you soon.' : "We got your order. If your payment didn't finish, no worries, you can pay at pickup.";
  }

  // ---------- boot ----------
  Promise.all([menu, stops]).then(([m, s]) => {
    M = m;
    flavorsById = new Map(m.flavors.map((f) => [f.id, f]));
    if (!m.orders_open) {
      const c = $('closed');
      c.innerHTML = 'Online ordering is paused right now. Please <a href="https://m.me/100064381800560" target="_blank" rel="noopener">message us on Facebook</a> or call <a href="tel:+12075887628">(207) 588-7628</a>.';
      c.hidden = false;
    }
    if (urlPack && m.products[urlPack]) document.querySelector(`[data-pack="${urlPack}"]`).click();
    else renderBuilder();
    setupFulfillment(s.stops);
    renderCart();
    updatePayUI();
    const paidCode = new URLSearchParams(location.search).get('paid');
    if (paidCode) showPaidReturn(paidCode);
  }).catch(() => showErr('Couldn\'t load the menu. Please refresh the page.'));
})();
