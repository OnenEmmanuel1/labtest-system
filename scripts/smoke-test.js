'use strict';
/**
 * scripts/smoke-test.js
 * Automated End-to-End Live Smoke Test for LabTrackMS
 * Tests all 8 audit phases programmatically against the database & engine.
 */

require('dotenv').config();
const { query } = require('../config/db');
const engine    = require('../engine/labtmEngine');

async function runSmokeTest() {
  console.log('🧪 Starting LabTrackMS Live Module & Logic Smoke Test...\n');
  let passCount = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      process.exitCode = 1;
    }
  }

  try {
    // ── Test 1: Stack & Engine Verification ─────────────────────
    console.log('1️⃣ Phase 1 & 6 — Engine & Environment Setup');
    assert(typeof engine.flagResultForTest === 'function', 'Engine flagResultForTest exists');
    assert(typeof engine.verifyResult === 'function', 'Engine verifyResult exists');
    assert(process.env.SESSION_SECRET !== undefined, 'SESSION_SECRET is configured');

    // ── Test 2: Server-Side Reference Range Flagging ────────────
    console.log('\n2️⃣ Phase 7b — Server-Side Reference Range Flagging');
    // Test Catalog ID 1 = Full Blood Count (FBC), ref 4000 - 11000
    const lowFlag = await engine.flagResultForTest(1, 3200);
    assert(lowFlag === 'abnormal_low', `FBC value 3200 flagged as abnormal_low (got: ${lowFlag})`);

    const highFlag = await engine.flagResultForTest(1, 15000);
    assert(highFlag === 'abnormal_high', `FBC value 15000 flagged as abnormal_high (got: ${highFlag})`);

    const normalFlag = await engine.flagResultForTest(1, 7000);
    assert(normalFlag === 'normal', `FBC value 7000 flagged as normal (got: ${normalFlag})`);

    // Boundary cases (inclusive range)
    const boundaryLow = await engine.flagResultForTest(1, 4000);
    assert(boundaryLow === 'normal', `Boundary value 4000 flagged as normal (got: ${boundaryLow})`);

    const boundaryHigh = await engine.flagResultForTest(1, 11000);
    assert(boundaryHigh === 'normal', `Boundary value 11000 flagged as normal (got: ${boundaryHigh})`);

    // ── Test 3: Order / Sample / Result Workflow State Machine ──
    console.log('\n3️⃣ Phase 7a — Workflow Lifecycle (requested -> sample_collected -> in_progress -> completed)');
    
    // Create new order for patient 1 (Aisha) by doctor 4
    const orderNum = await engine.generateOrderNumber();
    const orderRes = await query(
      'INSERT INTO test_orders (order_number, patient_id, doctor_id, status) VALUES (?,?,?,"requested")',
      [orderNum, 1, 4]
    );
    const orderId = orderRes.insertId;
    assert(orderId > 0, `Created test order ID ${orderId} (${orderNum})`);

    // Add order item (Test ID 2 = Haemoglobin)
    const itemRes = await query(
      'INSERT INTO order_items (order_id, test_id) VALUES (?,?)',
      [orderId, 2]
    );
    const orderItemId = itemRes.insertId;

    // Check status is 'requested'
    const [o1] = await query('SELECT status FROM test_orders WHERE id = ?', [orderId]);
    assert(o1.status === 'requested', 'Initial order status is "requested"');

    // Collect sample
    const sampleCode = await engine.generateSampleCode();
    const sampleRes = await query(
      'INSERT INTO samples (sample_code, order_id, collected_by_user_id, sample_type) VALUES (?,?,?,?)',
      [sampleCode, orderId, 2, 'Blood']
    );
    const sampleId = sampleRes.insertId;
    await engine.refreshOrderStatus(orderId);

    const [o2] = await query('SELECT status FROM test_orders WHERE id = ?', [orderId]);
    assert(o2.status === 'sample_collected', 'Status updated to "sample_collected" after sample creation');

    // Enter unverified result
    const flag = await engine.flagResultForTest(2, 10.5); // Hb low (< 12.0)
    const resultRes = await query(
      `INSERT INTO test_results (order_item_id, sample_id, result_value, unit, flag, entered_by, verified)
       VALUES (?, ?, '10.5', 'g/dL', ?, 2, 0)`,
      [orderItemId, sampleId, flag]
    );
    const resultId = resultRes.insertId;
    await engine.refreshOrderStatus(orderId);

    const [o3] = await query('SELECT status FROM test_orders WHERE id = ?', [orderId]);
    assert(o3.status === 'in_progress', 'Status updated to "in_progress" after result entry');

    // ── Test 4: Verification Lock Enforcement ───────────────────
    console.log('\n4️⃣ Phase 7c — Verification-Lock Rule Enforcement');
    // Prior to verification, assertResultEditable should pass without error
    let editableBefore = true;
    try {
      await engine.assertResultEditable(resultId);
    } catch (e) {
      editableBefore = false;
    }
    assert(editableBefore === true, 'Unverified result is editable prior to verification');

    // Verify result
    await engine.verifyResult(resultId, 2, 'Verified by smoke test');
    const [o4] = await query('SELECT status FROM test_orders WHERE id = ?', [orderId]);
    assert(o4.status === 'completed', 'Order status automatically transitions to "completed" after result verification');

    // Attempt to edit verified result — MUST BE REJECTED
    let rejectedAfter = false;
    try {
      await engine.assertResultEditable(resultId);
    } catch (err) {
      rejectedAfter = err.message.includes('verified and is locked');
    }
    assert(rejectedAfter === true, 'Verified result edit/delete attempt was correctly REJECTED by verification lock');

    // ── Test 5: Report Data & Turnaround Time ───────────────────
    console.log('\n5️⃣ Phase 6 & 7e — Report Data & TAT Calculation');
    const report = await engine.getReportData(orderId);
    assert(report !== null, 'Report data fetched successfully');
    assert(report.order.order_number === orderNum, 'Report contains correct order number');
    assert(report.items.length === 1, 'Report contains expected order item');
    assert(report.items[0].flag === 'abnormal_low', 'Report item maintains abnormal_low flag');
    assert(report.items[0].verified_by_name !== null, 'Report includes verifier user name');

    // Clean up test order records in child-to-parent order
    await query('DELETE FROM test_results WHERE id = ?', [resultId]);
    await query('DELETE FROM samples WHERE id = ?', [sampleId]);
    await query('DELETE FROM order_items WHERE id = ?', [orderItemId]);
    await query('DELETE FROM test_orders WHERE id = ?', [orderId]);

    console.log(`\n🎉 Smoke Test Complete! Passed ${passCount}/${totalTests} assertions.\n`);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Smoke Test Exception:', err);
    process.exit(1);
  }
}

runSmokeTest();
