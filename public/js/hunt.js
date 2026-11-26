// The Great Cheesecake Hunt: 5 little cheesecakes hidden around the site.
// Finding all 5 unlocks the giveaway entry in this browser, so there's no code to copy.
// Preview before launch with ?hunt=preview (remembered for this browser).
(function () {
  const KEY = 'bub-hunt';
  const params = new URLSearchParams(location.search);
  let preview = false;
  try {
    if (params.get('hunt') === 'preview') localStorage.setItem('bub-hunt-preview', '1');
    if (params.get('hunt') === 'off') localStorage.removeItem('bub-hunt-preview');
    preview = localStorage.getItem('bub-hunt-preview') === '1';
  } catch (e) {}
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

  // Small cheesecake slice in the brand colors.
  const ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 40 L56 26 L56 46 L8 54 Z" fill="#f6e7b8" stroke="#56085c" stroke-width="3" stroke-linejoin="round"/><path d="M8 40 L56 26 L56 31 L8 45 Z" fill="#fff8e6" stroke="#56085c" stroke-width="3" stroke-linejoin="round"/><path d="M8 50 L56 42 L56 46 L8 54 Z" fill="#c8964f" stroke="#56085c" stroke-width="3" stroke-linejoin="round"/><path d="M22 34 q4 -10 10 -4 q4 -8 9 0" fill="#fff" stroke="#56085c" stroke-width="2.5"/><circle cx="33" cy="22" r="5" fill="#b0123a" stroke="#56085c" stroke-width="2"/><path d="M33 17 q2 -5 6 -6" fill="none" stroke="#56085c" stroke-width="2"/></svg>';

  // Where each cheesecake hides. Only the ones on the current page get placed.
  const SPOTS = [
    { id: 1, sel: '.hero .stats', where: 'beforeend' },
    { id: 2, sel: '#flavors .legend', where: 'beforeend' },
    { id: 3, sel: '.page-hero .lede', where: 'beforeend', page: 'find' },
    { id: 4, sel: '.cart .hint.center', where: 'beforeend' },
    { id: 5, sel: '.foot-bottom a[href*="getrealeasysites"]', where: 'afterend' }
  ];

  fetch('/api/hunt').then((r) => r.json()).then((st) => {
    if (!st.on) return;
    if (!st.open && !(preview && !st.started)) return;
    start(st);
  }).catch(() => {});

  function start(st) {
    const state = load();
    state.found = state.found || [];
    const prize = `${st.winners > 1 ? st.winners + ' winners each get ' : 'One winner gets '}${st.prize}`;

    // Styles live here so the hunt can be removed by deleting one script tag.
    const css = document.createElement('style');
    css.textContent = `
      .hunt-cake { display:inline-flex; width:34px; height:34px; border:0; padding:0; margin:0 .35rem; vertical-align:middle; background:none; cursor:pointer; animation: huntWiggle 3.2s ease-in-out infinite; }
      .hunt-cake svg { width:100%; height:100%; filter: drop-shadow(0 2px 3px rgba(51,4,58,.25)); }
      .hunt-cake.found { animation:none; opacity:.35; filter:grayscale(1); cursor:default; }
      .hunt-cake.pop { animation: huntPop .5s ease; }
      @keyframes huntWiggle { 0%,86%,100% { transform: rotate(0) } 90% { transform: rotate(-14deg) } 94% { transform: rotate(12deg) } }
      /* Bigger and livelier on computers, where they were too easy to miss */
      @media (min-width: 861px) {
        .hunt-cake { width:50px; height:50px; margin:0 .5rem; animation-duration: 2.2s; }
        .hunt-cake:not(.found) svg { filter: drop-shadow(0 0 6px rgba(216,231,166,.95)) drop-shadow(0 3px 4px rgba(51,4,58,.3)); }
        .hunt-cake:hover { transform: scale(1.15); }
      }
      @keyframes huntPop { 0% { transform: scale(1) } 50% { transform: scale(1.7) rotate(10deg) } 100% { transform: scale(1) } }
      .hunt-pill { position:fixed; left:14px; bottom:14px; z-index:70; background:#33043a; color:#fff; border:2px solid #d8e7a6; border-radius:999px; padding:.45em .9em .45em .5em; font:700 .9rem 'DM Sans',sans-serif; display:flex; align-items:center; gap:.45em; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.25); }
      .hunt-pill svg { width:26px; height:26px; background:#fff; border-radius:50%; padding:2px; }
      body.has-bar .hunt-pill { bottom: 84px; }
      @media (min-width: 861px) { body.has-bar .hunt-pill { bottom: 14px; } }
      .hunt-card { background:#fff; border:2px solid #d8e7a6; border-radius:20px; padding:1.4rem 1.5rem; box-shadow:0 10px 30px rgba(51,4,58,.08); display:grid; grid-template-columns:auto 1fr; gap:1.1rem; align-items:center; }
      .hunt-card .big { width:74px; height:74px; }
      .hunt-card h2 { font-size:clamp(1.4rem,3vw,1.9rem); margin:.1rem 0 .3rem; }
      .hunt-card p { margin:.2rem 0; text-shadow:none !important; }
      .hunt-dots { display:flex; gap:.35rem; margin-top:.5rem; }
      .hunt-dots i { width:14px; height:14px; border-radius:50%; background:#efe6f0; border:2px solid #56085c; }
      .hunt-dots i.on { background:#56085c; }
      .hunt-modal { position:fixed; inset:0; z-index:100; background:rgba(51,4,58,.55); display:grid; place-items:center; padding:1rem; }
      .hunt-modal .box { background:#fff; border-radius:22px; padding:1.6rem; width:min(440px,100%); max-height:92vh; overflow:auto; text-align:center; box-shadow:0 30px 80px rgba(0,0,0,.35); }
      .hunt-modal .box h2 { font-size:1.6rem; }
      .hunt-modal .box .big { width:84px; height:84px; margin:0 auto .5rem; }
      .hunt-modal form { text-align:left; margin-top:1rem; }
      .hunt-modal label { margin-top:.7rem; }
      .hunt-modal .row2 { display:flex; gap:.6rem; justify-content:center; flex-wrap:wrap; margin-top:1rem; }
      .hunt-res { background:#f3e9f4; border-radius:14px; padding:1rem; margin-top:1rem; text-align:left; }
      .hunt-res img { width:46px; height:46px; float:left; margin-right:.7rem; border-radius:10px; }
      .hunt-toast { position:fixed; left:50%; top:90px; transform:translateX(-50%); z-index:101; background:#33043a; color:#fff; padding:.7em 1.3em; border-radius:999px; font-weight:700; box-shadow:0 10px 30px rgba(0,0,0,.3); transition:opacity .3s; }
      @media (max-width:560px) { .hunt-card { grid-template-columns:1fr; text-align:center; } .hunt-card .big { margin:0 auto; } .hunt-dots { justify-content:center; } }
    `;
    document.head.appendChild(css);

    // Place this page's cheesecakes.
    for (const s of SPOTS) {
      const el = document.querySelector(s.sel);
      if (!el || (s.page === 'find' && !location.pathname.startsWith('/find'))) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hunt-cake' + (state.found.includes(s.id) ? ' found' : '');
      b.innerHTML = ICON; b.setAttribute('aria-label', 'Hidden cheesecake! Tap to collect it');
      b.addEventListener('click', () => collect(s.id, b));
      el.insertAdjacentElement(s.where, b);
    }

    // Rules card on the home page, under the hero.
    const hero = document.querySelector('.hero');
    let card = null;
    if (hero) {
      const sec = document.createElement('section');
      sec.style.padding = '0 0 1rem';
      sec.innerHTML = `<div class="wrap"><div class="hunt-card"><div class="big">${ICON}</div><div>
        <span class="eyebrow">Launch giveaway${preview && !st.started ? ' · PREVIEW' : ''}</span>
        <h2>The Great Cheesecake Hunt</h2>
        <p><b>5 little cheesecakes are hidden around this website.</b> Find and tap all 5 to unlock your entry. ${esc(prize)}!</p>
        <p>Entries close ${esc(fmt(st.end))} at 6 PM. One entry per phone number.</p>
        <div class="hunt-dots" aria-label="Cheesecakes found"></div></div></div></div>`;
      hero.insertAdjacentElement('afterend', sec);
      card = sec;
    }

    // Floating progress button on every page.
    const pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'hunt-pill';
    pill.addEventListener('click', () => (state.found.length >= 5 ? entryModal() : rulesModal()));
    document.body.appendChild(pill);
    refresh();

    function refresh() {
      const n = state.found.length;
      pill.innerHTML = `${ICON}<span>${state.entered ? "You're entered!" : `Cheesecake Hunt ${n}/5`}</span>`;
      if (card) card.querySelector('.hunt-dots').innerHTML = [1, 2, 3, 4, 5].map((i) => `<i class="${state.found.includes(i) ? 'on' : ''}"></i>`).join('');
    }

    function toast(msg) {
      const t = document.createElement('div'); t.className = 'hunt-toast'; t.textContent = msg;
      document.body.appendChild(t); setTimeout(() => (t.style.opacity = 0), 1800); setTimeout(() => t.remove(), 2200);
    }

    function collect(id, btn) {
      if (state.found.includes(id)) return;
      state.found.push(id); save(state);
      btn.classList.add('pop'); setTimeout(() => btn.classList.add('found'), 450);
      refresh();
      if (id === 5) return builtByModal();
      if (state.found.length >= 5) return entryModal();
      toast(`You found ${state.found.length} of 5!`);
    }

    function modal(html) {
      const m = document.createElement('div'); m.className = 'hunt-modal';
      m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
      document.body.appendChild(m);
      return m;
    }

    function rulesModal() {
      const n = state.found.length;
      modal(`<div class="big">${ICON}</div><h2>The Great Cheesecake Hunt</h2>
        <p>You've found <b>${n} of 5</b>. Keep looking! They're tucked around the home page, the flavor board, Find a Slice, the order page and the very bottom of the site.</p>
        <p class="muted">${esc(prize)}. Entries close ${esc(fmt(st.end))} at 6 PM.</p>
        <div class="row2"><button class="btn" data-close>Keep hunting</button></div>`);
    }

    // Cheesecake #5 sits by the website credit.
    function builtByModal() {
      const left = 5 - state.found.length;
      const m = modal(`<div class="big">${ICON}</div><h2>You found one!</h2>
        <p>${left ? `${state.found.length} of 5 found, just ${left} to go.` : 'That was the last one!'}</p>
        <div class="hunt-res"><img src="/img/res-logo.png" alt="" onerror="this.remove()"><b>This website was built by Real Easy Sites</b>, a small business in Saco, Maine.
        Want a site like this for your business? Visit <a href="https://getrealeasysites.com" target="_blank" rel="noopener">getrealeasysites.com</a>.</div>
        <div class="row2"><button class="btn" data-next>${left ? 'Keep hunting' : 'Enter the giveaway'}</button></div>`);
      m.querySelector('[data-next]').addEventListener('click', () => { m.remove(); if (!left) entryModal(); });
    }

    function entryModal() {
      if (state.entered) {
        return modal(`<div class="big">${ICON}</div><h2>You're entered!</h2><p>Good luck! We'll contact the winners after ${esc(fmt(st.end))}.</p><div class="row2"><a class="btn" href="/order">Order cheesecake</a><button class="btn ghost" data-close>Close</button></div>`);
      }
      const m = modal(`<div class="big">${ICON}</div><h2>You found all 5!</h2>
        <p>${esc(prize)}. Enter below for your chance to win.</p>
        <form novalidate>
          <label for="h-name">Name</label><input id="h-name" autocomplete="name" required>
          <label for="h-phone">Phone (so we can reach you if you win)</label><input id="h-phone" type="tel" autocomplete="tel" required>
          <label for="h-email">Email (optional)</label><input id="h-email" type="email" autocomplete="email">
          <div class="sr-only" aria-hidden="true"><input id="h-web" tabindex="-1" autocomplete="off"></div>
          <div class="err" id="h-err" hidden></div>
          <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:1rem">Enter the giveaway</button>
          <p class="hint center">One entry per phone number. Winners drawn ${esc(fmt(st.end))} after 6 PM.</p>
        </form>`);
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = m.querySelector('#h-err'); err.hidden = true;
        const btn = m.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const r = await fetch('/api/hunt/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            name: m.querySelector('#h-name').value, phone: m.querySelector('#h-phone').value, email: m.querySelector('#h-email').value,
            website: m.querySelector('#h-web').value, found: state.found, preview: preview && !st.started }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Something went wrong.');
          state.entered = true; save(state); refresh();
          m.querySelector('.box').innerHTML = `<div class="big">${ICON}</div><h2>${d.already ? "You're already entered!" : "You're entered!"}</h2>
            <p>${d.already ? 'That phone number is already in the drawing.' : 'Good luck!'} We'll contact the winners after ${esc(fmt(st.end))}.</p>
            <p>Share the hunt with a friend so they can play too!</p>
            <div class="row2"><a class="btn" href="/order">Order cheesecake</a><button class="btn ghost" data-close>Close</button></div>`;
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      });
    }
  }
})();
