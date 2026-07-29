'use strict';
/**
 * routes/api/patients.js
 * JSON API for patient search (used by order form patient picker)
 */
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { query } = require('../../config/db');

const router = express.Router();

// GET /api/patients/search?q=term
router.get('/search', requireAuth, async (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  try {
    const patients = await query(
      `SELECT id, patient_unique_id, name, date_of_birth, gender, phone
       FROM patients
       WHERE name LIKE ? OR phone LIKE ? OR patient_unique_id LIKE ?
       ORDER BY name LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/patients/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [patient] = await query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (!patient) return res.status(404).json({ error: 'Not found' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
