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
  next();
});

// Admin first, so /admin always asks for the password before anything else.
app.use(require('./routes/admin'));
app.use(require('./routes/wholesale'));
app.use('/api', express.json({ limit: '50kb' }), require('./routes/public'));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Batter Up Bakery site on port ${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD not set: dashboard login is disabled');
});
