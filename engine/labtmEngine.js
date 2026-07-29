'use strict';
/**
 * LabTrackMS — Business Logic Engine  v2.0
 * engine/labtmEngine.js
 *
 * ALL business rules live here, NEVER in route handlers.
 * Routes call these functions; they never contain raw DB queries.
 *
 * Key enforced rules:
 *  - Result verification-lock: once verified=1, no edits or deletions
 *  - Reference-range flagging: programmatic comparison (not free-text)
 *  - Order status auto-refresh based on child item verification state
 */

const { query } = require('../config/db');

// ─────────────────────────────────────────────────────────────────
// REFERENCE-RANGE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────

/**
 * Compare a numeric result against a test's reference range.
 * @param {string|number} value
 * @param {number|null}   refLow
 * @param {number|null}   refHigh
 * @returns {'normal'|'abnormal_high'|'abnormal_low'|null}
 */
function classifyResult(value, refLow, refHigh) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const num = parseFloat(String(value));
  if (isNaN(num)) return null; // qualitative result — no numeric flag
  if (refLow  !== null && num < parseFloat(refLow))  return 'abnormal_low';
  if (refHigh !== null && num > parseFloat(refHigh)) return 'abnormal_high';
  return 'normal';
}

/**
 * Fetch test catalog entry, then classify the result.
 * @param {number} testId
 * @param {string|number} resultValue
 * @returns {Promise<string|null>}
 */
async function flagResultForTest(testId, resultValue) {
  const rows = await query(
    'SELECT reference_low, reference_high FROM test_catalog WHERE id = ? AND is_active = 1',
    [testId]
  );
  if (!rows.length) throw new Error(`Test ID ${testId} not found in catalog.`);
  const { reference_low, reference_high } = rows[0];
  return classifyResult(resultValue, reference_low, reference_high);
}

// ─────────────────────────────────────────────────────────────────
// ORDER STATUS LIFECYCLE
// Lifecycle: requested → sample_collected → in_progress → completed
// ─────────────────────────────────────────────────────────────────

/**
 * Recompute and persist the aggregate status of a test_order
 * based on the verification state of its order_items' results.
 *
 * Rules:
 *  - 'requested'        : no sample collected yet (no samples row for order)
 *  - 'sample_collected' : sample exists but no results entered at all
 *  - 'in_progress'      : at least one result entered (verified or not)
 *  - 'completed'        : ALL order_items have a verified result
 *
 * @param {number} orderId
 */
async function refreshOrderStatus(orderId) {
  // Check if a sample exists for this order
  const sampleRows = await query(
    'SELECT id FROM samples WHERE order_id = ? LIMIT 1',
    [orderId]
  );
  const hasSample = sampleRows.length > 0;

  if (!hasSample) {
    await query("UPDATE test_orders SET status = 'requested' WHERE id = ?", [orderId]);
    return;
  }

  // Get all order_items and their result state
  const items = await query(`
    SELECT oi.id,
           tr.id        AS result_id,
           tr.verified  AS is_verified
    FROM order_items oi
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE oi.order_id = ?
  `, [orderId]);

  if (!items.length) return;

  const totalItems    = items.length;
  const hasAnyResult  = items.some(i => i.result_id !== null);
  const verifiedCount = items.filter(i => i.is_verified === 1).length;

  let newStatus;
  if (verifiedCount === totalItems) {
    newStatus = 'completed';
  } else if (hasAnyResult) {
    newStatus = 'in_progress';
  } else {
    newStatus = 'sample_collected';
  }

  await query('UPDATE test_orders SET status = ? WHERE id = ?', [newStatus, orderId]);
}

// ─────────────────────────────────────────────────────────────────
// VERIFICATION LOCK ENFORCEMENT
// ─────────────────────────────────────────────────────────────────

/**
 * Check whether a test_result is locked (verified=1).
 * Throws if locked to prevent edit/delete at app layer.
 * @param {number} resultId
 */
async function assertResultEditable(resultId) {
  const [result] = await query(
    'SELECT verified FROM test_results WHERE id = ?', [resultId]
  );
  if (!result) throw new Error('Result not found.');
  if (result.verified) {
    throw new Error(
      'This result has been verified and is locked. Verified results cannot be edited or deleted.'
    );
  }
}

/**
 * Verify a result (mark verified=1, set verified_by, verified_at).
 * Enforces the business rule: technician confirms entry is final.
 * Automatically refreshes the parent order's status.
 *
 * @param {number} resultId
 * @param {number} verifierUserId
 * @param {string|null} notes   — optional additional notes
 */
async function verifyResult(resultId, verifierUserId, notes) {
  const [result] = await query(
    'SELECT * FROM test_results WHERE id = ?', [resultId]
  );
  if (!result) throw new Error('Result not found.');
  if (result.verified) throw new Error('Result is already verified.');

  await query(`
    UPDATE test_results
    SET verified = 1, verified_by = ?, verified_at = NOW(),
        notes = COALESCE(?, notes)
    WHERE id = ?
  `, [verifierUserId, notes || null, resultId]);

  // Determine the parent order_id
  const [oi] = await query(
    'SELECT oi.order_id FROM order_items oi WHERE oi.id = ?', [result.order_item_id]
  );
  if (oi) await refreshOrderStatus(oi.order_id);
}

// ─────────────────────────────────────────────────────────────────
// ID GENERATORS
// ─────────────────────────────────────────────────────────────────

/** Generate a unique order number: ORD-YYYYMMDD-NNN */
async function generateOrderNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix  = `ORD-${dateStr}-`;
  const rows = await query(
    'SELECT order_number FROM test_orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1',
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length) seq = parseInt(rows[0].order_number.split('-').pop(), 10) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/** Generate a unique sample code: SPL-YYYYMMDD-NNN */
async function generateSampleCode() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix  = `SPL-${dateStr}-`;
  const rows = await query(
    'SELECT sample_code FROM samples WHERE sample_code LIKE ? ORDER BY sample_code DESC LIMIT 1',
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length) seq = parseInt(rows[0].sample_code.split('-').pop(), 10) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/** Generate a unique patient ID: PAT-NNNNNN */
async function generatePatientId() {
  const rows = await query(
    'SELECT patient_unique_id FROM patients ORDER BY id DESC LIMIT 1'
  );
  let seq = 1;
  if (rows.length) {
    seq = parseInt(rows[0].patient_unique_id.replace('PAT-', ''), 10) + 1;
  }
  return `PAT-${String(seq).padStart(6, '0')}`;
}

// ─────────────────────────────────────────────────────────────────
// DUPLICATE PATIENT CHECK
// ─────────────────────────────────────────────────────────────────

/**
 * Check for possible duplicate patients by name+DOB or phone.
 * @returns {Promise<Array>}
 */
async function findPossibleDuplicatePatients(name, dob, phone) {
  const conditions = [];
  const params     = [];

  conditions.push('(LOWER(name) = LOWER(?) AND date_of_birth = ?)');
  params.push(name, dob);

  if (phone && String(phone).trim()) {
    conditions.push('(phone = ?)');
    params.push(String(phone).trim());
  }

  return query(
    `SELECT * FROM patients WHERE ${conditions.join(' OR ')} LIMIT 5`,
    params
  );
}

// ─────────────────────────────────────────────────────────────────
// TURNAROUND TIME
// ─────────────────────────────────────────────────────────────────

function computeTurnaroundHours(collectedAt, verifiedAt) {
  const start = new Date(collectedAt);
  const end   = new Date(verifiedAt);
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

function isWithinTurnaroundTarget(actualHours, targetHours) {
  return actualHours <= targetHours;
}

// ─────────────────────────────────────────────────────────────────
// ANALYTICS ENGINE
// ─────────────────────────────────────────────────────────────────

/** Overall dashboard stats for admin */
async function getDashboardStats() {
  const [totals] = await query(`
    SELECT
      (SELECT COUNT(*) FROM patients)                                          AS total_patients,
      (SELECT COUNT(*) FROM test_orders)                                       AS total_orders,
      (SELECT COUNT(*) FROM test_orders WHERE status = 'requested')            AS pending_orders,
      (SELECT COUNT(*) FROM test_orders WHERE status = 'completed')            AS complete_orders,
      (SELECT COUNT(*) FROM test_results WHERE verified = 0)                   AS awaiting_verification,
      (SELECT COUNT(*) FROM test_results
       WHERE verified = 1 AND flag IN ('abnormal_high','abnormal_low'))        AS flagged_results
  `);
  return totals;
}

/** Average turnaround time by test (verified results only) */
async function getAvgTurnaroundByTest() {
  return query(`
    SELECT
      tc.test_name,
      d.name                                                             AS department,
      tc.turnaround_time_hours                                           AS target_hours,
      COUNT(tr.id)                                                       AS total_verified,
      ROUND(
        AVG(TIMESTAMPDIFF(MINUTE, s.collected_at, tr.verified_at)) / 60, 2
      )                                                                  AS avg_hours,
      SUM(
        CASE WHEN TIMESTAMPDIFF(MINUTE, s.collected_at, tr.verified_at) / 60
             <= tc.turnaround_time_hours THEN 1 ELSE 0 END
      )                                                                  AS within_target
    FROM test_results tr
    JOIN order_items oi  ON oi.id = tr.order_item_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN departments d   ON d.id  = tc.department_id
    JOIN samples s       ON s.id  = tr.sample_id
    WHERE tr.verified = 1
      AND s.collected_at IS NOT NULL
      AND tr.verified_at IS NOT NULL
    GROUP BY tc.id, tc.test_name, d.name, tc.turnaround_time_hours
    ORDER BY avg_hours DESC
  `);
}

/** Order volume by date range */
async function getOrderVolume(startDate, endDate) {
  return query(`
    SELECT
      DATE(o.order_date) AS order_date,
      COUNT(o.id)        AS order_count,
      COUNT(oi.id)       AS item_count
    FROM test_orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE DATE(o.order_date) BETWEEN ? AND ?
    GROUP BY DATE(o.order_date)
    ORDER BY order_date ASC
  `, [startDate, endDate]);
}

/** Abnormal result rate by test */
async function getAbnormalRateByTest() {
  return query(`
    SELECT
      tc.test_name,
      d.name                                                       AS department,
      COUNT(tr.id)                                                 AS total_results,
      SUM(CASE WHEN tr.flag = 'normal'        THEN 1 ELSE 0 END)  AS normal_count,
      SUM(CASE WHEN tr.flag = 'abnormal_high' THEN 1 ELSE 0 END)  AS high_count,
      SUM(CASE WHEN tr.flag = 'abnormal_low'  THEN 1 ELSE 0 END)  AS low_count,
      ROUND(
        SUM(CASE WHEN tr.flag IN ('abnormal_high','abnormal_low') THEN 1 ELSE 0 END)
        * 100.0 / COUNT(tr.id), 1
      )                                                            AS abnormal_pct
    FROM test_results tr
    JOIN order_items oi  ON oi.id = tr.order_item_id
    JOIN test_catalog tc ON tc.id = oi.test_id
    JOIN departments d   ON d.id  = tc.department_id
    WHERE tr.verified = 1
      AND tr.flag IS NOT NULL
    GROUP BY tc.id, tc.test_name, d.name
    ORDER BY abnormal_pct DESC
  `);
}

/** Volume by department */
async function getVolumeByDepartment(startDate, endDate) {
  return query(`
    SELECT
      d.name                                  AS department,
      COUNT(DISTINCT o.id)                    AS order_count,
      COUNT(oi.id)                            AS test_count,
      SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END) AS verified_count
    FROM departments d
    JOIN test_catalog tc ON tc.department_id = d.id
    JOIN order_items oi  ON oi.test_id = tc.id
    JOIN test_orders o   ON o.id = oi.order_id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id
    WHERE DATE(o.order_date) BETWEEN ? AND ?
    GROUP BY d.id, d.name
    ORDER BY test_count DESC
  `, [startDate, endDate]);
}

// ─────────────────────────────────────────────────────────────────
// REPORT DATA (for doctor/admin printable report)
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch complete report data for a given order.
 * Returns null if order not found.
 * Items includes only verified results.
 */
async function getReportData(orderId) {
  const orderRows = await query(`
    SELECT o.*,
           p.patient_unique_id, p.name AS patient_name,
           p.date_of_birth, p.gender, p.phone, p.address,
           u.name AS doctor_name
    FROM test_orders o
    JOIN patients p ON p.id = o.patient_id
    JOIN users u    ON u.id = o.doctor_id
    WHERE o.id = ?
  `, [orderId]);

  if (!orderRows.length) return null;
  const order = orderRows[0];

  const items = await query(`
    SELECT oi.id,
           tc.test_name, tc.unit,
           tc.reference_low, tc.reference_high, tc.turnaround_time_hours,
           d.name AS department,
           tr.result_value, tr.flag, tr.notes AS result_notes,
           tr.entered_at, tr.verified_at,
           ue.name AS entered_by_name,
           uv.name AS verified_by_name,
           s.collected_at, s.sample_type
    FROM order_items oi
    JOIN test_catalog tc  ON tc.id = oi.test_id
    JOIN departments d    ON d.id  = tc.department_id
    LEFT JOIN test_results tr ON tr.order_item_id = oi.id AND tr.verified = 1
    LEFT JOIN samples s       ON s.id = tr.sample_id
    LEFT JOIN users ue        ON ue.id = tr.entered_by
    LEFT JOIN users uv        ON uv.id = tr.verified_by
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
  `, [orderId]);

  const itemsWithTat = items.map(item => ({
    ...item,
    tat_hours: item.collected_at && item.verified_at
      ? computeTurnaroundHours(item.collected_at, item.verified_at)
      : null,
    within_target: item.collected_at && item.verified_at
      ? isWithinTurnaroundTarget(
          computeTurnaroundHours(item.collected_at, item.verified_at),
          item.turnaround_time_hours
        )
      : null,
  }));

  return { order, items: itemsWithTat };
}

// ─────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────

function buildCsv(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = v => (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const lines   = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = {
  // Classification
  classifyResult,
  flagResultForTest,
  // Order lifecycle
  refreshOrderStatus,
  // Verification lock
  assertResultEditable,
  verifyResult,
  // ID generators
  generateOrderNumber,
  generateSampleCode,
  generatePatientId,
  // Duplicate check
  findPossibleDuplicatePatients,
  // Turnaround
  computeTurnaroundHours,
  isWithinTurnaroundTarget,
  // Analytics
  getDashboardStats,
  getAvgTurnaroundByTest,
  getOrderVolume,
  getAbnormalRateByTest,
  getVolumeByDepartment,
  // Report
  getReportData,
  // CSV
  buildCsv,
};
