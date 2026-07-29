'use strict';
/**
 * routes/pages/technician.js
 * Technician role: collect samples, enter results, verify results
 *
 * Key business rules enforced:
 *  - Technician CANNOT delete a patient record (admin only)
 *  - Once a result is verified (verified=1), it is LOCKED — no edits or deletions
 *  - Reference-range flagging is computed server-side in the engine
 *  - Order status auto-refreshes after each result action
 */
const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { query }  = require('../../config/db');
const engine     = require('../../engine/labtmEngine');

const router = express.Router();
const guard  = [requireAuth, requireRole('technician', 'admin')];

// ── DASHBOARD ──────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
  // Orders awaiting sample collection (status = requested)
  const pendingCollection = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           u.name AS doctor_name,
           COUNT(oi.id) AS item_count
    FROM test_orders o
    JOIN patients p    ON p.id = o.patient_id
    JOIN users u       ON u.id = o.doctor_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'requested'
    GROUP BY o.id
    ORDER BY o.order_date ASC LIMIT 10
  `);

  // Order items awaiting result entry (order has sample but no result yet)
  const pendingResults = await query(`
    SELECT oi.id, oi.order_id, oi.test_id,
           tc.test_name, tc.unit, tc.reference_low, tc.reference_high,
           p.name AS patient_name, p.patient_unique_id,
           o.order_number, s.sample_code, s.collected_at
    FROM order_items oi
    JOIN test_orders o   ON o.id = oi.order_id
    JOIN patients p      ON p.id = o.patient_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN samples s       ON s.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE tr.id IS NULL
    ORDER BY s.collected_at ASC LIMIT 10
  `);

  // Results awaiting verification (entered but not verified)
  const pendingVerification = await query(`
    SELECT tr.id AS result_id, tr.result_value, tr.flag, tr.entered_at,
           oi.id AS order_item_id, tc.test_name, tc.unit,
           p.name AS patient_name, p.patient_unique_id,
           o.order_number, s.sample_code
    FROM test_results tr
    JOIN order_items oi  ON oi.id = tr.order_item_id
    JOIN test_orders o   ON o.id = oi.order_id
    JOIN patients p      ON p.id = o.patient_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN samples s       ON s.id  = tr.sample_id
    WHERE tr.verified = 0
    ORDER BY tr.entered_at ASC LIMIT 10
  `);

  const myToday = await query(`
    SELECT
      (SELECT COUNT(*) FROM samples WHERE collected_by_user_id = ? AND DATE(collected_at) = CURDATE()) AS collected,
      (SELECT COUNT(*) FROM test_results WHERE entered_by = ? AND DATE(entered_at) = CURDATE())       AS entered,
      (SELECT COUNT(*) FROM test_results WHERE verified_by = ? AND DATE(verified_at) = CURDATE())     AS verified
  `, [req.session.user.id, req.session.user.id, req.session.user.id]);

  res.render('technician/dashboard', {
    title: 'Lab Workbench — LabTrackMS',
    currentPath: '/technician/dashboard',
    pendingCollection,
    pendingResults,
    pendingVerification,
    myToday: myToday[0],
  });
});

// ── SAMPLE COLLECTION ──────────────────────────────────────────

// All orders needing sample collection
router.get('/collect', guard, async (req, res) => {
  const orders = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           u.name AS doctor_name,
           COUNT(oi.id) AS item_count
    FROM test_orders o
    JOIN patients p    ON p.id = o.patient_id
    JOIN users u       ON u.id = o.doctor_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'requested'
    GROUP BY o.id
    ORDER BY o.order_date ASC
  `);
  res.render('technician/collect', {
    title: 'Sample Collection — LabTrackMS',
    currentPath: '/technician/collect',
    orders,
  });
});

// GET: sample collection form for a specific order
router.get('/collect/:orderId', guard, async (req, res) => {
  const [order] = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           p.date_of_birth, p.gender, p.phone,
           u.name AS doctor_name
    FROM test_orders o
    JOIN patients p ON p.id = o.patient_id
    JOIN users u    ON u.id = o.doctor_id
    WHERE o.id = ?
  `, [req.params.orderId]);

  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/technician/collect'); }
  if (order.status !== 'requested') {
    req.flash('error', 'Sample already collected or order is not in "requested" status.');
    return res.redirect('/technician/collect');
  }

  const items = await query(`
    SELECT oi.id, tc.test_name, tc.unit
    FROM order_items oi
    JOIN test_catalog tc ON tc.id = oi.test_id
    WHERE oi.order_id = ?
  `, [req.params.orderId]);

  res.render('technician/collect-form', {
    title: `Collect Sample — ${order.order_number}`,
    currentPath: '/technician/collect',
    order, items,
  });
});

// POST: record sample collection
router.post('/collect/:orderId', guard, async (req, res) => {
  const { sample_type, notes } = req.body;
  try {
    const [order] = await query('SELECT * FROM test_orders WHERE id = ?', [req.params.orderId]);
    if (!order) throw new Error('Order not found.');
    if (order.status !== 'requested') throw new Error('Sample already collected for this order.');

    const sampleCode = await engine.generateSampleCode();
    await query(
      'INSERT INTO samples (sample_code, order_id, collected_by_user_id, sample_type, notes) VALUES (?,?,?,?,?)',
      [sampleCode, req.params.orderId, req.session.user.id, sample_type || 'Blood', notes || null]
    );

    // Transition order to sample_collected
    await query("UPDATE test_orders SET status = 'sample_collected' WHERE id = ?", [req.params.orderId]);

    req.flash('success', `Sample ${sampleCode} collected successfully. You can now enter results.`);
    res.redirect('/technician/results');
  } catch (err) {
    console.error(err);
    req.flash('error', err.message);
    res.redirect(`/technician/collect/${req.params.orderId}`);
  }
});

// ── RESULT ENTRY ───────────────────────────────────────────────

// List: all order items awaiting result entry
router.get('/results', guard, async (req, res) => {
  const items = await query(`
    SELECT oi.id, oi.order_id, oi.test_id,
           tc.test_name, tc.unit, tc.reference_low, tc.reference_high,
           p.name AS patient_name, p.patient_unique_id,
           o.order_number, s.sample_code, s.collected_at, s.sample_type,
           tr.id AS result_id, tr.result_value, tr.flag, tr.verified, tr.entered_at
    FROM order_items oi
    JOIN test_orders o   ON o.id = oi.order_id
    JOIN patients p      ON p.id = o.patient_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN samples s       ON s.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE o.status IN ('sample_collected', 'in_progress')
    ORDER BY s.collected_at ASC
  `);
  res.render('technician/results', {
    title: 'Result Entry — LabTrackMS',
    currentPath: '/technician/results',
    items,
  });
});

// GET: result entry form for a specific order item
router.get('/results/:orderItemId/enter', guard, async (req, res) => {
  const [item] = await query(`
    SELECT oi.id, oi.order_id, oi.test_id,
           tc.test_name, tc.unit, tc.reference_low, tc.reference_high, tc.description,
           p.name AS patient_name, p.patient_unique_id, p.date_of_birth, p.gender,
           o.order_number, s.sample_code, s.collected_at, s.sample_type, s.id AS sample_id
    FROM order_items oi
    JOIN test_orders o   ON o.id = oi.order_id
    JOIN patients p      ON p.id = o.patient_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN samples s       ON s.order_id = o.id
    WHERE oi.id = ?
  `, [req.params.orderItemId]);

  if (!item) { req.flash('error', 'Order item not found.'); return res.redirect('/technician/results'); }

  // Check if result already exists and verified — cannot re-enter
  const [existing] = await query('SELECT * FROM test_results WHERE order_item_id = ?', [req.params.orderItemId]);
  if (existing && existing.verified) {
    req.flash('error', 'This result is verified and locked.');
    return res.redirect('/technician/results');
  }

  res.render('technician/result-entry', {
    title: `Enter Result — ${item.sample_code}`,
    currentPath: '/technician/results',
    item, existing: existing || null,
  });
});

// POST: submit result entry
router.post('/results/:orderItemId/enter', guard, async (req, res) => {
  const { result_value, notes } = req.body;
  const orderItemId = req.params.orderItemId;

  try {
    const [item] = await query(`
      SELECT oi.*, s.id AS sample_id
      FROM order_items oi
      JOIN samples s ON s.order_id = oi.order_id
      WHERE oi.id = ?
    `, [orderItemId]);
    if (!item) throw new Error('Order item not found.');

    // Verify lock — if existing result is verified, block
    const [existing] = await query('SELECT * FROM test_results WHERE order_item_id = ?', [orderItemId]);
    if (existing && existing.verified) {
      throw new Error('This result is verified and locked. It cannot be modified.');
    }

    // Compute flag server-side
    const flag = await engine.flagResultForTest(item.test_id, result_value);

    if (existing) {
      // Update existing unverified result
      await query(`
        UPDATE test_results
        SET result_value = ?, flag = ?, notes = ?, entered_by = ?, entered_at = NOW()
        WHERE order_item_id = ?
      `, [result_value, flag, notes || null, req.session.user.id, orderItemId]);
    } else {
      // Insert new result
      await query(`
        INSERT INTO test_results
          (order_item_id, sample_id, result_value, unit, flag, entered_by, entered_at, notes)
        SELECT ?, s.id, ?, tc.unit, ?, ?, NOW(), ?
        FROM order_items oi
        JOIN test_catalog tc ON tc.id = oi.test_id
        JOIN samples s       ON s.order_id = oi.order_id
        WHERE oi.id = ?
      `, [orderItemId, result_value, flag, req.session.user.id, notes || null, orderItemId]);
    }

    // Refresh order status
    await engine.refreshOrderStatus(item.order_id);

    const flagMsg = flag ? ` — Flagged: ${flag.replace(/_/g, ' ')}` : '';
    req.flash('success', `Result recorded${flagMsg}. Ready for verification.`);
    res.redirect('/technician/results');
  } catch (err) {
    console.error(err);
    req.flash('error', err.message);
    res.redirect(`/technician/results/${orderItemId}/enter`);
  }
});

// ── RESULT VERIFICATION ────────────────────────────────────────

// List: all entered, unverified results
router.get('/verify', guard, async (req, res) => {
  const results = await query(`
    SELECT tr.id AS result_id, tr.result_value, tr.flag, tr.entered_at, tr.notes,
           oi.id AS order_item_id,
           tc.test_name, tc.unit, tc.reference_low, tc.reference_high,
           p.name AS patient_name, p.patient_unique_id,
           o.order_number, s.sample_code, s.collected_at,
           ue.name AS entered_by_name
    FROM test_results tr
    JOIN order_items oi  ON oi.id = tr.order_item_id
    JOIN test_orders o   ON o.id = oi.order_id
    JOIN patients p      ON p.id = o.patient_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN samples s       ON s.id  = tr.sample_id
    LEFT JOIN users ue   ON ue.id = tr.entered_by
    WHERE tr.verified = 0
    ORDER BY tr.entered_at ASC
  `);
  res.render('technician/verify', {
    title: 'Result Verification — LabTrackMS',
    currentPath: '/technician/verify',
    results,
  });
});

// POST: verify a result — LOCK it permanently
router.post('/verify/:resultId', guard, async (req, res) => {
  const { notes } = req.body;
  try {
    await engine.verifyResult(req.params.resultId, req.session.user.id, notes);
    req.flash('success', 'Result verified and locked. No further edits are permitted.');
    res.redirect('/technician/verify');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/technician/verify');
  }
});

// POST: delete an UNVERIFIED result (verified ones are locked)
router.post('/results/:resultId/delete', guard, async (req, res) => {
  try {
    await engine.assertResultEditable(req.params.resultId);
    const [tr] = await query(
      'SELECT tr.*, oi.order_id FROM test_results tr JOIN order_items oi ON oi.id = tr.order_item_id WHERE tr.id = ?',
      [req.params.resultId]
    );
    await query('DELETE FROM test_results WHERE id = ?', [req.params.resultId]);
    if (tr) await engine.refreshOrderStatus(tr.order_id);
    req.flash('success', 'Result deleted. You can now re-enter it.');
    res.redirect('/technician/results');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/technician/results');
  }
});

// ── COMPLETED ORDERS (view-only for technician) ────────────────
router.get('/orders', guard, async (req, res) => {
  const orders = await query(`
    SELECT o.*, p.name AS patient_name, p.patient_unique_id,
           COUNT(DISTINCT oi.id) AS item_count,
           SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END) AS verified_count,
           s.sample_code
    FROM test_orders o
    JOIN patients p    ON p.id = o.patient_id
    LEFT JOIN order_items oi  ON oi.order_id = o.id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    LEFT JOIN samples s       ON s.order_id = o.id
    GROUP BY o.id, s.sample_code
    ORDER BY o.order_date DESC LIMIT 60
  `);
  res.render('technician/orders', {
    title: 'All Orders — LabTrackMS',
    currentPath: '/technician/orders',
    orders,
  });
});

module.exports = router;
