// Find a slice: searchable list of shops, grouped by delivery day and route.
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
    let html = '';
    for (const d of ['Tuesday', 'Wednesday']) {
      const inDay = hit.filter((s) => s.day === d);
      if (!inDay.length) continue;
      html += `<div class="day-group"><h2>${d} delivery <span class="tag">${inDay.length} ${inDay.length === 1 ? 'shop' : 'shops'}</span></h2><div class="stops">`;
      html += inDay.map((s) => `<div class="stop"><b>${esc(s.name)}</b><span>${esc(s.town)}</span><br><a href="${mapLink(s)}" target="_blank" rel="noopener">Directions</a></div>`).join('');
      html += '</div></div>';
    }
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
