'use strict';
/**
 * routes/pages/admin.js
 * Administrator panel: users, departments, test catalog, analytics, reports
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { query }  = require('../../config/db');
const engine     = require('../../engine/labtmEngine');

const router = express.Router();
const guard  = [requireAuth, requireRole('admin')];

// ── DASHBOARD ──────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
  try {
    const stats = await engine.getDashboardStats();
    const recentOrders = await query(`
      SELECT o.*, p.name AS patient_name, p.patient_unique_id,
             u.name AS doctor_name
      FROM test_orders o
      JOIN patients p ON p.id = o.patient_id
      JOIN users u    ON u.id = o.doctor_id
      ORDER BY o.order_date DESC LIMIT 10
    `);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard — LabTrackMS',
      currentPath: '/admin/dashboard',
      stats, recentOrders,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

// ── DEPARTMENTS ────────────────────────────────────────────────

router.get('/departments', guard, async (req, res) => {
  const departments = await query('SELECT * FROM departments ORDER BY name');
  res.render('admin/departments', {
    title: 'Departments — LabTrackMS',
    currentPath: '/admin/departments',
    departments,
  });
});

router.post('/departments', guard, async (req, res) => {
  const { name } = req.body;
  try {
    await query('INSERT INTO departments (name) VALUES (?)', [name.trim()]);
    req.flash('success', `Department "${name}" created.`);
  } catch (err) {
    req.flash('error', err.message.includes('Duplicate') ? 'Department name already exists.' : err.message);
  }
  res.redirect('/admin/departments');
});

router.post('/departments/:id/edit', guard, async (req, res) => {
  const { name } = req.body;
  try {
    await query('UPDATE departments SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    req.flash('success', 'Department updated.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/admin/departments');
});

router.post('/departments/:id/delete', guard, async (req, res) => {
  try {
    await query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    req.flash('success', 'Department deleted.');
  } catch (err) {
    req.flash('error', 'Cannot delete — department has tests linked to it.');
  }
  res.redirect('/admin/departments');
});

// ── TEST CATALOG ───────────────────────────────────────────────

router.get('/catalog', guard, async (req, res) => {
  const tests = await query(`
    SELECT tc.*, d.name AS department_name
    FROM test_catalog tc
    JOIN departments d ON d.id = tc.department_id
    ORDER BY d.name, tc.test_name
  `);
  const departments = await query('SELECT * FROM departments ORDER BY name');
  res.render('admin/catalog', {
    title: 'Test Catalog — LabTrackMS',
    currentPath: '/admin/catalog',
    tests, departments,
  });
});

router.get('/catalog/new', guard, async (req, res) => {
  const departments = await query('SELECT * FROM departments ORDER BY name');
  res.render('admin/catalog-form', {
    title: 'Add Test — LabTrackMS',
    currentPath: '/admin/catalog',
    test: null, departments,
  });
});

router.post('/catalog', guard, async (req, res) => {
  const { department_id, test_name, description, price,
          turnaround_time_hours, reference_low, reference_high, unit } = req.body;
  try {
    await query(
      `INSERT INTO test_catalog
         (department_id, test_name, description, price, turnaround_time_hours,
          reference_low, reference_high, unit)
       VALUES (?,?,?,?,?,?,?,?)`,
      [department_id, test_name, description || null, price || 0,
       turnaround_time_hours || 24,
       reference_low !== '' ? reference_low : null,
       reference_high !== '' ? reference_high : null,
       unit || null]
    );
    req.flash('success', `Test "${test_name}" added to catalog.`);
    res.redirect('/admin/catalog');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/catalog/new');
  }
});

router.get('/catalog/:id/edit', guard, async (req, res) => {
  const [test] = await query('SELECT * FROM test_catalog WHERE id = ?', [req.params.id]);
  if (!test) { req.flash('error', 'Test not found.'); return res.redirect('/admin/catalog'); }
  const departments = await query('SELECT * FROM departments ORDER BY name');
  res.render('admin/catalog-form', {
    title: 'Edit Test — LabTrackMS',
    currentPath: '/admin/catalog',
    test, departments,
  });
});

router.post('/catalog/:id/edit', guard, async (req, res) => {
  const { department_id, test_name, description, price,
          turnaround_time_hours, reference_low, reference_high, unit, is_active } = req.body;
  try {
    await query(
      `UPDATE test_catalog
       SET department_id=?, test_name=?, description=?, price=?,
           turnaround_time_hours=?, reference_low=?, reference_high=?,
           unit=?, is_active=?
       WHERE id=?`,
      [department_id, test_name, description || null, price || 0,
       turnaround_time_hours || 24,
       reference_low !== '' ? reference_low : null,
       reference_high !== '' ? reference_high : null,
       unit || null, is_active ? 1 : 0, req.params.id]
    );
    req.flash('success', `Test "${test_name}" updated.`);
    res.redirect('/admin/catalog');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect(`/admin/catalog/${req.params.id}/edit`);
  }
});

router.post('/catalog/:id/delete', guard, async (req, res) => {
  // Soft-delete (deactivate) to preserve history
  await query('UPDATE test_catalog SET is_active = 0 WHERE id = ?', [req.params.id]);
  req.flash('success', 'Test deactivated from catalog.');
  res.redirect('/admin/catalog');
});

// ── USER MANAGEMENT ────────────────────────────────────────────

router.get('/users', guard, async (req, res) => {
  const users = await query('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY role, name');
  res.render('admin/users', {
    title: 'User Management — LabTrackMS',
    currentPath: '/admin/users',
    users,
  });
});

router.get('/users/new', guard, (req, res) => {
  res.render('admin/user-form', {
    title: 'Add User — LabTrackMS',
    currentPath: '/admin/users',
    editUser: null,
  });
});

router.post('/users', guard, async (req, res) => {
  const { name, email, role, password, specialty } = req.body;
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)',
      [name, email, hash, role]
    );
    // If doctor, also create doctors record
    if (role === 'doctor') {
      await query('INSERT INTO doctors (user_id, specialty) VALUES (?,?)',
        [result.insertId, specialty || null]);
    }
    req.flash('success', `User "${name}" created successfully.`);
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('error', err.message.includes('Duplicate') ? 'Email already in use.' : err.message);
    res.redirect('/admin/users/new');
  }
});

router.get('/users/:id/edit', guard, async (req, res) => {
  const [editUser] = await query(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?', [req.params.id]
  );
  if (!editUser) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  // Get specialty if doctor
  const [doctorRow] = await query('SELECT specialty FROM doctors WHERE user_id = ?', [req.params.id]);
  res.render('admin/user-form', {
    title: 'Edit User — LabTrackMS',
    currentPath: '/admin/users',
    editUser: { ...editUser, specialty: doctorRow ? doctorRow.specialty : '' },
  });
});

router.post('/users/:id/edit', guard, async (req, res) => {
  const { name, email, role, is_active, password, specialty } = req.body;
  try {
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password, 12);
      await query('UPDATE users SET name=?, email=?, role=?, is_active=?, password_hash=? WHERE id=?',
        [name, email, role, is_active ? 1 : 0, hash, req.params.id]);
    } else {
      await query('UPDATE users SET name=?, email=?, role=?, is_active=? WHERE id=?',
        [name, email, role, is_active ? 1 : 0, req.params.id]);
    }
    // Manage doctors record
    if (role === 'doctor') {
      const [existing] = await query('SELECT id FROM doctors WHERE user_id = ?', [req.params.id]);
      if (existing) {
        await query('UPDATE doctors SET specialty = ? WHERE user_id = ?', [specialty || null, req.params.id]);
      } else {
        await query('INSERT INTO doctors (user_id, specialty) VALUES (?,?)', [req.params.id, specialty || null]);
      }
    } else {
      await query('DELETE FROM doctors WHERE user_id = ?', [req.params.id]);
    }
    req.flash('success', `User "${name}" updated.`);
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect(`/admin/users/${req.params.id}/edit`);
  }
});

router.post('/users/:id/delete', guard, async (req, res) => {
  // Soft-delete only — never hard-delete users (audit trail)
  await query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
  req.flash('success', 'User deactivated.');
  res.redirect('/admin/users');
});

// ── PATIENT MANAGEMENT (admin can delete — per business rule) ──

router.get('/patients', guard, async (req, res) => {
  const search = req.query.q || '';
  let patients;
  if (search) {
    patients = await query(
      'SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? OR patient_unique_id LIKE ? ORDER BY name LIMIT 50',
      [`%${search}%`, `%${search}%`, `%${search}%`]
    );
  } else {
    patients = await query('SELECT * FROM patients ORDER BY created_at DESC LIMIT 60');
  }
  res.render('admin/patients', {
    title: 'Patients — LabTrackMS',
    currentPath: '/admin/patients',
    patients, search,
  });
});

router.post('/patients/:id/delete', guard, async (req, res) => {
  try {
    await query('DELETE FROM patients WHERE id = ?', [req.params.id]);
    req.flash('success', 'Patient record deleted.');
  } catch (err) {
    req.flash('error', 'Cannot delete patient — they have associated orders.');
  }
  res.redirect('/admin/patients');
});

// ── ANALYTICS & REPORTS ────────────────────────────────────────

router.get('/analytics', guard, async (req, res) => {
  const startDate = req.query.start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDate   = req.query.end   || new Date().toISOString().slice(0, 10);

  const [tatData, volumeData, abnormalData, deptData, stats] = await Promise.all([
    engine.getAvgTurnaroundByTest(),
    engine.getOrderVolume(startDate, endDate),
    engine.getAbnormalRateByTest(),
    engine.getVolumeByDepartment(startDate, endDate),
    engine.getDashboardStats(),
  ]);

  res.render('admin/analytics', {
    title: 'Analytics — LabTrackMS',
    currentPath: '/admin/analytics',
    tatData, volumeData, abnormalData, deptData,
    stats, startDate, endDate,
  });
});

// CSV export
router.get('/analytics/export', guard, async (req, res) => {
  const type = req.query.type || 'tat';
  const startDate = req.query.start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDate   = req.query.end   || new Date().toISOString().slice(0, 10);
  let rows, filename;

  if (type === 'volume') {
    rows = await engine.getOrderVolume(startDate, endDate);
    filename = `order-volume-${startDate}-to-${endDate}.csv`;
  } else if (type === 'abnormal') {
    rows = await engine.getAbnormalRateByTest();
    filename = 'abnormal-rate-by-test.csv';
  } else if (type === 'dept') {
    rows = await engine.getVolumeByDepartment(startDate, endDate);
    filename = `volume-by-department-${startDate}-to-${endDate}.csv`;
  } else {
    rows = await engine.getAvgTurnaroundByTest();
    filename = 'turnaround-time-by-test.csv';
  }

  const csv = engine.buildCsv(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Report view for any order
router.get('/report/:orderId', guard, async (req, res) => {
  const data = await engine.getReportData(req.params.orderId);
  if (!data) {
    req.flash('error', 'Order not found.');
    return res.redirect('/admin/analytics');
  }
  res.render('shared/report', {
    title: `Lab Report — ${data.order.order_number}`,
    currentPath: '/admin/analytics',
    ...data,
    printMode: req.query.print === '1',
  });
});

module.exports = router;
