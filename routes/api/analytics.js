'use strict';
/**
 * routes/api/analytics.js
 * JSON API for analytics data (used by admin dashboard charts)
 */
const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');
const engine = require('../../engine/labtmEngine');

const router  = express.Router();
const guard   = [requireAuth, requireRole('admin')];

// GET /api/analytics/dashboard-stats
router.get('/dashboard-stats', guard, async (req, res) => {
  try {
    res.json(await engine.getDashboardStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/tat
router.get('/tat', guard, async (req, res) => {
  try {
    res.json(await engine.getAvgTurnaroundByTest());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/abnormal
router.get('/abnormal', guard, async (req, res) => {
  try {
    res.json(await engine.getAbnormalRateByTest());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/volume?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/volume', guard, async (req, res) => {
  const startDate = req.query.start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDate   = req.query.end   || new Date().toISOString().slice(0, 10);
  try {
    res.json(await engine.getOrderVolume(startDate, endDate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
