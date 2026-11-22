// Find a slice: searchable list of shops, A to Z by town, marked Minis or Slices.
(function () {
  const { esc, stops } = window.BUB;
  const list = document.getElementById('stop-list');
  const q = document.getElementById('q');
  let day = 'all';
  let all = [];

  const params = new URLSearchParams(location.search);
  if (params.get('q')) q.value = params.get('q');

  function mapLink(s) {
    const query = encodeURIComponent(`${s.name.replace(/\s*\(.*\)/, '')}, ${s.town}, Maine`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  function render() {
    const term = q.value.trim().toLowerCase();
    const hit = all.filter((s) => (day === 'all' || s.day === day) &&
      (!term || s.town.toLowerCase().includes(term) || s.name.toLowerCase().includes(term)));
    if (!hit.length) {
      list.innerHTML = `<div class="no-results"><p>No shops match "${esc(q.value)}" yet.</p><p>We can still get you cheesecake: <a href="/order">order online</a> for a route meet-up, BUB Shed pickup or shipping anywhere in Maine.</p></div>`;
      return;
    }
    const sorted = hit.slice().sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));
    let html = '', letter = '';
    html += `<p class="muted" style="margin:0 0 1rem">${sorted.length} ${sorted.length === 1 ? 'shop' : 'shops'}${day === 'all' ? '' : ' on ' + day}, A to Z by town</p><div class="stops">`;
    for (const s of sorted) {
      html += `<div class="stop"><span class="tag" style="float:right;${s.slices ? 'background:#fde8ea;color:#8a1424' : ''}">${s.slices ? 'Slices' : 'Minis'}</span><b>${esc(s.town)}</b><span>${esc(s.name)}</span><br><span class="muted" style="font-size:.85rem">${esc(s.day)} delivery</span> · <a href="${mapLink(s)}" target="_blank" rel="noopener">Directions</a></div>`;
    }
    html += '</div>';
    list.innerHTML = html;
  }

  stops.then((r) => { all = r.stops; render(); }).catch(() => {
    list.innerHTML = '<p class="muted">Couldn\'t load the shop list. Please refresh the page.</p>';
  });
  q.addEventListener('input', render);
  document.querySelectorAll('.pill').forEach((b) => b.addEventListener('click', () => {
    day = b.dataset.day;
    document.querySelectorAll('.pill').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
})();
