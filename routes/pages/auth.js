'use strict';
const express = require('express');
const bcrypt  = require('bcrypt');
const { query } = require('../../config/db');

const router = express.Router();

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(roleHome(req.session.user.role));
  }
  res.render('auth/login', { title: 'Login — LabTrackMS' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const rows = await query(
      'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (!rows.length) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    req.session.user = {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    };
    res.redirect(roleHome(user.role));
  } catch (err) {
    console.error(err);
    req.flash('error', 'A server error occurred. Please try again.');
    res.redirect('/auth/login');
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

function roleHome(role) {
  const map = {
    admin:      '/admin/dashboard',
    doctor:     '/doctor/dashboard',
    technician: '/technician/dashboard',
  };
  return map[role] || '/auth/login';
}

module.exports = router;
