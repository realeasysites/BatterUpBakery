// Batter Up Bakery website. Built by Real Easy Sites (getrealeasysites.com).
const path = require('path');
const express = require('express');
require('./db'); // creates the database and seed data on first run

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Send anyone on the old onrender.com address to the real domain (set CANONICAL_HOST on Render).
app.use((req, res, next) => {
  const canon = process.env.CANONICAL_HOST;
  if (canon && req.hostname && req.hostname !== canon && req.hostname.endsWith('.onrender.com') && req.method === 'GET' && req.path !== '/healthz') {
    return res.redirect(301, `https://${canon}${req.originalUrl}`);
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // The V2 playground is a copy of the site: keep it out of Google so customers only find the real one.
  if (process.env.PLAYGROUND === '1') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Admin first, so /admin always asks for the password before anything else.
app.use(require('./routes/admin'));
// Wholesale invoicing is an add-on: only on when WHOLESALE_ENABLED=1 (the V2 playground has it on).
const WHOLESALE = process.env.WHOLESALE_ENABLED === '1';
if (WHOLESALE) app.use(require('./routes/wholesale'));

// Private preview: until the owner flips "Website is public" in Prices & settings, only people
// signed in to the dashboard (Loreen and Kivvy) see the site. Everyone else gets a coming-soon page.
const { isAuthed } = require('./lib/auth');
const { getSettings } = require('./db');
const OPEN_PATHS = /^\/(css|img|fonts)\/|^\/(favicon\.ico|robots\.txt|healthz)$/;
app.use((req, res, next) => {
  if (OPEN_PATHS.test(req.path) || getSettings().site_public === '1' || isAuthed(req)) return next();
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Opening soon.' });
  res.status(200).sendFile(path.join(__dirname, 'public', 'soon.html'));
});

app.use(require('./routes/hunt'));
app.use(require('./routes/traffic'));
app.use('/api', express.json({ limit: '50kb' }), require('./routes/public'));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

// Safety net: a failed request should never take the whole site down.
app.use((err, req, res, next) => {
  console.error('request failed', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again or call (207) 588-7628.' });
});
process.on('unhandledRejection', (e) => console.error('unhandled error', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Batter Up Bakery site on port ${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD not set: dashboard login is disabled');
});
