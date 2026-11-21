// Batter Up Bakery website. Built by Real Easy Sites (getrealeasysites.com).
const path = require('path');
const express = require('express');
require('./db'); // creates the database and seed data on first run

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

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
app.use('/api', express.json({ limit: '50kb' }), require('./routes/public'));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Batter Up Bakery site on port ${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD not set: dashboard login is disabled');
});
