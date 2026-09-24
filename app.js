'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const session = require('express-session');
const flash   = require('connect-flash');

// ── Page routes ──────────────────────────────────────────────────
const authRoutes       = require('./routes/pages/auth');
const adminRoutes      = require('./routes/pages/admin');
const doctorRoutes     = require('./routes/pages/doctor');
const technicianRoutes = require('./routes/pages/technician');

// ── API routes ───────────────────────────────────────────────────
const apiPatientsRoutes  = require('./routes/api/patients');
const apiOrdersRoutes    = require('./routes/api/orders');
const apiAnalyticsRoutes = require('./routes/api/analytics');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── View engine ──────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Session ──────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET must be set'); })(),
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
  },
}));

// ── Flash messages ───────────────────────────────────────────────
app.use(flash());

// ── Global template locals ───────────────────────────────────────
app.use((req, res, next) => {
  res.locals.appName  = process.env.APP_NAME || 'LabTrackMS';
  res.locals.user     = req.session.user || null;
  res.locals.errors   = req.flash('error');
  res.locals.success  = req.flash('success');
  next();
});

// ── Root redirect ────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    const redirectMap = {
      admin:      '/admin/dashboard',
      doctor:     '/doctor/dashboard',
      technician: '/technician/dashboard',
    };
    return res.redirect(redirectMap[req.session.user.role] || '/auth/login');
  }
  res.redirect('/auth/login');
});

// ── Page routes ──────────────────────────────────────────────────
app.use('/auth',       authRoutes);
app.use('/admin',      adminRoutes);
app.use('/doctor',     doctorRoutes);
app.use('/technician', technicianRoutes);

// ── API routes ───────────────────────────────────────────────────
app.use('/api/patients',  apiPatientsRoutes);
app.use('/api/orders',    apiOrdersRoutes);
app.use('/api/analytics', apiAnalyticsRoutes);

// ── 404 handler ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title:   '404 — Page Not Found',
    message: 'The page you are looking for does not exist.',
    user:    req.session ? req.session.user : null,
  });
});

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title:   '500 — Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
    user:    req.session ? req.session.user : null,
  });
});

// ── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  LabTrackMS running → http://localhost:${PORT}\n`);
  console.log('   Roles: admin@labtm.com | doctor1@labtm.com | tech1@labtm.com');
  console.log('   Password: password123\n');
});

module.exports = app;
