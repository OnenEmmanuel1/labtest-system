'use strict';
/**
 * routes/pages/doctor.js
 * Doctor role: register patients, create orders, view results & print reports
 */
const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { query }  = require('../../config/db');
const engine     = require('../../engine/labtmEngine');

const router = express.Router();
const guard  = [requireAuth, requireRole('doctor', 'admin')];

// ── DASHBOARD ──────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
  const myOrders = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           COUNT(oi.id) AS item_count,
           SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END) AS verified_count
    FROM test_orders o
    JOIN patients p    ON p.id = o.patient_id
    LEFT JOIN order_items oi  ON oi.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE o.doctor_id = ?
    GROUP BY o.id
    ORDER BY o.order_date DESC LIMIT 10
  `, [req.session.user.id]);

  const stats = await query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'requested'        THEN 1 ELSE 0 END) AS requested,
      SUM(CASE WHEN status = 'sample_collected'  THEN 1 ELSE 0 END) AS sample_collected,
      SUM(CASE WHEN status = 'in_progress'       THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'completed'         THEN 1 ELSE 0 END) AS completed
    FROM test_orders WHERE doctor_id = ?
  `, [req.session.user.id]);

  res.render('doctor/dashboard', {
    title: 'Doctor Dashboard — LabTrackMS',
    currentPath: '/doctor/dashboard',
    myOrders,
    stats: stats[0],
  });
});

// ── PATIENT MANAGEMENT ─────────────────────────────────────────

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
  res.render('doctor/patients', {
    title: 'Patients — LabTrackMS',
    currentPath: '/doctor/patients',
    patients, search,
  });
});

router.get('/patients/new', guard, async (req, res) => {
  const { name, dob, phone } = req.query;
  let duplicates = [];
  if (name && dob) {
    duplicates = await engine.findPossibleDuplicatePatients(name, dob, phone);
  }
  res.render('doctor/patient-form', {
    title: 'Register Patient — LabTrackMS',
    currentPath: '/doctor/patients',
    patient: null, duplicates,
    prefill: req.query,
  });
});

router.post('/patients', guard, async (req, res) => {
  const { name, date_of_birth, gender, phone, address, force } = req.body;
  try {
    if (!force) {
      const dupes = await engine.findPossibleDuplicatePatients(name, date_of_birth, phone);
      if (dupes.length) {
        req.flash('error', 'Possible duplicate patient detected. Review below or click "Confirm & Register" to proceed.');
        return res.render('doctor/patient-form', {
          title: 'Register Patient — LabTrackMS',
          currentPath: '/doctor/patients',
          patient: null, duplicates: dupes,
          prefill: req.body,
        });
      }
    }
    const patientId = await engine.generatePatientId();
    await query(
      'INSERT INTO patients (patient_unique_id, name, date_of_birth, gender, phone, address) VALUES (?,?,?,?,?,?)',
      [patientId, name, date_of_birth, gender, phone || null, address || null]
    );
    req.flash('success', `Patient registered with ID: ${patientId}`);
    res.redirect('/doctor/patients');
  } catch (err) {
    console.error(err);
    req.flash('error', err.message);
    res.redirect('/doctor/patients/new');
  }
});

router.get('/patients/:id', guard, async (req, res) => {
  const [patient] = await query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
  if (!patient) { req.flash('error', 'Patient not found.'); return res.redirect('/doctor/patients'); }

  const orders = await query(`
    SELECT o.*, COUNT(oi.id) AS item_count,
           SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END) AS verified_count
    FROM test_orders o
    LEFT JOIN order_items oi  ON oi.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE o.patient_id = ?
    GROUP BY o.id
    ORDER BY o.order_date DESC
  `, [patient.id]);

  res.render('doctor/patient-view', {
    title: `${patient.name} — LabTrackMS`,
    currentPath: '/doctor/patients',
    patient, orders,
  });
});

// ── TEST ORDERS ────────────────────────────────────────────────

router.get('/orders/new', guard, async (req, res) => {
  const { patient_id } = req.query;
  let patient = null;
  if (patient_id) {
    [patient] = await query('SELECT * FROM patients WHERE id = ?', [patient_id]);
  }
  const tests = await query(`
    SELECT tc.*, d.name AS department_name
    FROM test_catalog tc
    JOIN departments d ON d.id = tc.department_id
    WHERE tc.is_active = 1
    ORDER BY d.name, tc.test_name
  `);
  const patients = await query('SELECT id, patient_unique_id, name, date_of_birth, gender FROM patients ORDER BY name LIMIT 100');
  res.render('doctor/order-form', {
    title: 'New Test Order — LabTrackMS',
    currentPath: '/doctor/orders',
    patient, tests, patients,
  });
});

router.post('/orders', guard, async (req, res) => {
  const { patient_id, test_ids, notes } = req.body;
  const testArr = Array.isArray(test_ids) ? test_ids : (test_ids ? [test_ids] : []);
  if (!testArr.length) {
    req.flash('error', 'Please select at least one test.');
    return res.redirect('/doctor/orders/new');
  }
  try {
    const orderNumber = await engine.generateOrderNumber();
    const [orderResult] = await query(
      'INSERT INTO test_orders (order_number, patient_id, doctor_id, notes) VALUES (?,?,?,?)',
      [orderNumber, patient_id, req.session.user.id, notes || null]
    );
    const orderId = orderResult.insertId;

    for (const testId of testArr) {
      if (!testId) continue;
      await query('INSERT INTO order_items (order_id, test_id) VALUES (?,?)', [orderId, testId]);
    }

    req.flash('success', `Order ${orderNumber} created successfully.`);
    res.redirect(`/doctor/orders/${orderId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', err.message);
    res.redirect('/doctor/orders/new');
  }
});

router.get('/orders', guard, async (req, res) => {
  const statusFilter = req.query.status || '';
  let sql = `
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           COUNT(DISTINCT oi.id) AS item_count,
           SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END) AS verified_count
    FROM test_orders o
    JOIN patients p    ON p.id = o.patient_id
    LEFT JOIN order_items oi  ON oi.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE o.doctor_id = ?
  `;
  const params = [req.session.user.id];
  if (statusFilter) { sql += ' AND o.status = ?'; params.push(statusFilter); }
  sql += ' GROUP BY o.id ORDER BY o.order_date DESC LIMIT 80';

  const orders = await query(sql, params);
  res.render('doctor/orders', {
    title: 'My Orders — LabTrackMS',
    currentPath: '/doctor/orders',
    orders, statusFilter,
  });
});

router.get('/orders/:id', guard, async (req, res) => {
  const [order] = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           p.date_of_birth, p.gender, p.phone, p.address
    FROM test_orders o
    JOIN patients p ON p.id = o.patient_id
    WHERE o.id = ? AND o.doctor_id = ?
  `, [req.params.id, req.session.user.id]);

  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/doctor/orders'); }

  const items = await query(`
    SELECT oi.id, oi.test_id,
           tc.test_name, tc.unit, tc.price,
           tc.reference_low, tc.reference_high,
           d.name AS department_name,
           tr.id AS result_id, tr.result_value, tr.flag,
           tr.verified, tr.entered_at, tr.verified_at,
           tr.notes AS result_notes,
           ue.name AS entered_by_name,
           uv.name AS verified_by_name
    FROM order_items oi
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN departments d   ON d.id  = tc.department_id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    LEFT JOIN users ue ON ue.id = tr.entered_by
    LEFT JOIN users uv ON uv.id = tr.verified_by
    WHERE oi.order_id = ?
    ORDER BY oi.id
  `, [req.params.id]);

  res.render('doctor/order-view', {
    title: `Order ${order.order_number} — LabTrackMS`,
    currentPath: '/doctor/orders',
    order, items,
  });
});

// ── REPORTS ────────────────────────────────────────────────────

router.get('/report/:orderId', guard, async (req, res) => {
  // Verify order belongs to this doctor (or admin)
  const [orderCheck] = await query(
    'SELECT id FROM test_orders WHERE id = ? AND (doctor_id = ? OR ? = 0)',
    [req.params.orderId, req.session.user.id, req.session.user.role === 'admin' ? 0 : 1]
  );

  const data = await engine.getReportData(req.params.orderId);
  if (!data) {
    req.flash('error', 'Order not found.');
    return res.redirect('/doctor/orders');
  }

  res.render('shared/report', {
    title: `Lab Report — ${data.order.order_number}`,
    currentPath: '/doctor/orders',
    ...data,
    printMode: req.query.print === '1',
  });
});

module.exports = router;
