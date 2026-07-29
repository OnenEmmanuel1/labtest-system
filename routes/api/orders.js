'use strict';
/**
 * routes/api/orders.js
 * JSON API for orders (status checks, quick-view)
 */
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { query } = require('../../config/db');

const router = express.Router();

// GET /api/orders/:id/status — quick status check
router.get('/:id/status', requireAuth, async (req, res) => {
  try {
    const [order] = await query(`
      SELECT o.id, o.order_number, o.status,
             COUNT(DISTINCT oi.id)                                      AS item_count,
             SUM(CASE WHEN tr.verified = 1 THEN 1 ELSE 0 END)          AS verified_count
      FROM test_orders o
      LEFT JOIN order_items oi  ON oi.order_id = o.id
      LEFT JOIN test_results tr ON tr.order_item_id = oi.id
      WHERE o.id = ?
      GROUP BY o.id
    `, [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
