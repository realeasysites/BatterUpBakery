// Weekly order cycle, in Maine time (America/New_York).
// Orders close Saturday at 6 PM. Orders placed before that are for the
// following week: route meet-ups Tuesday/Wednesday, UPS ships Wednesday,
// BUB Shed pickup Wednesday to Saturday 9 to 5.
const TZ = 'America/New_York';
const CUTOFF_HOUR = 18; // 6 PM Saturday
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function maineNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: +get('year'), m: +get('month'), d: +get('day'), hour: +get('hour'), wd };
}

// Plain calendar-date helpers (UTC noon avoids any DST edge).
function mkDate(y, m, d) { return new Date(Date.UTC(y, m - 1, d, 12)); }
function addDays(date, n) { const x = new Date(date); x.setUTCDate(x.getUTCDate() + n); return x; }
function iso(date) { return date.toISOString().slice(0, 10); }
function pretty(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
}

function currentCycle(now = new Date()) {
  const t = maineNow(now);
  let daysToSat = (6 - t.wd + 7) % 7;
  if (daysToSat === 0 && t.hour >= CUTOFF_HOUR) daysToSat = 7;
  const cutoff = addDays(mkDate(t.y, t.m, t.d), daysToSat);
  const tue = addDays(cutoff, 3);
  const wed = addDays(cutoff, 4);
  const pickupDays = [4, 5, 6, 7].map((n) => addDays(cutoff, n));
  return {
    cutoff: { date: iso(cutoff), label: `${pretty(cutoff)} at 6 PM` },
    route: { Tuesday: { date: iso(tue), label: pretty(tue) }, Wednesday: { date: iso(wed), label: pretty(wed) } },
    ship: { date: iso(wed), label: pretty(wed) },
    pickup: pickupDays.map((d) => ({ date: iso(d), label: pretty(d), day: DAY_NAMES[d.getUTCDay()] }))
  };
}

module.exports = { currentCycle };
