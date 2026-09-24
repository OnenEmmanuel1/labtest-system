-- ============================================================
-- LabTrackMS Seed Data  v2.0
-- Run AFTER schema.sql
-- Default password for ALL accounts: password123
-- bcrypt hash (saltRounds=12): $2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW
-- ============================================================
USE labtm_db;

-- ─────────────────────────────────────────
-- 1. USERS  (1 admin, 2 technicians, 2 doctors)
-- ─────────────────────────────────────────
INSERT INTO users (name, email, password_hash, role) VALUES
('Admin Lawal',          'admin@labtm.com',       '$2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW', 'admin'),
('Emmanuel Chukwu',      'tech1@labtm.com',        '$2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW', 'technician'),
('Ngozi Eze',            'tech2@labtm.com',        '$2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW', 'technician'),
('Dr. Sarah Adeyemi',    'doctor1@labtm.com',      '$2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW', 'doctor'),
('Dr. Yemi Okafor',      'doctor2@labtm.com',      '$2b$12$NgKSXV0C3xtlu05C3JY4F.DlpYUHUgbPmGsX585JMqDKVqg3HIHyW', 'doctor');

-- ─────────────────────────────────────────
-- 2. DEPARTMENTS  (2 as required)
-- ─────────────────────────────────────────
INSERT INTO departments (name) VALUES
('Haematology & Biochemistry'),
('Microbiology & Serology');

-- ─────────────────────────────────────────
-- 3. DOCTORS  (doctor profile records)
-- ─────────────────────────────────────────
INSERT INTO doctors (user_id, specialty) VALUES
(4, 'Internal Medicine'),
(5, 'Endocrinology');

-- ─────────────────────────────────────────
-- 4. PATIENTS  (3 sample patients, no login)
-- ─────────────────────────────────────────
INSERT INTO patients (patient_unique_id, name, date_of_birth, gender, phone, address) VALUES
('PAT-000001', 'Aisha Bello',   '1990-03-15', 'female', '08012345678', '12 Broad Street, Lagos'),
('PAT-000002', 'Chidi Nwankwo', '1985-07-22', 'male',   '08023456789', '45 Independence Ave, Abuja'),
('PAT-000003', 'Funmi Adeleke', '2000-11-08', 'female', '08034567890', '8 Victoria Island, Lagos');

-- ─────────────────────────────────────────
-- 5. TEST_CATALOG  (6 tests with structured reference ranges)
-- ─────────────────────────────────────────
INSERT INTO test_catalog (department_id, test_name, description, price, turnaround_time_hours, reference_low, reference_high, unit) VALUES
(1, 'Full Blood Count (FBC)',       'Complete blood count including WBC, RBC, platelets',        3500.00,  4, 4000,  11000, 'cells/µL'),
(1, 'Haemoglobin (Hb)',             'Measures haemoglobin concentration in blood',                1500.00,  2, 12.0,  17.5,  'g/dL'),
(1, 'Fasting Blood Sugar (FBS)',    'Fasting plasma glucose level',                               2000.00,  3, 3.9,   5.5,   'mmol/L'),
(1, 'Serum Creatinine',             'Kidney function marker',                                     2500.00,  4, 44.0,  106.0, 'µmol/L'),
(2, 'HIV Serology (ELISA)',         'HIV 1 & 2 antibody/antigen screening test (Index value)',    3000.00,  6, 0,     0.9,   'Index'),
(2, 'Thyroid Stimulating Hormone',  'TSH level for thyroid function assessment',                  7500.00,  8, 0.27,  4.2,   'mIU/L');

-- ─────────────────────────────────────────
-- 6. TEST_ORDERS (4 orders across different statuses)
-- ─────────────────────────────────────────
-- Order 1: Aisha — completed (all results verified, one out-of-range)
-- Order 2: Chidi — in_progress (sample collected, results being worked on)
-- Order 3: Funmi — sample_collected (sample taken, no results yet)
-- Order 4: Aisha — requested (newly placed, no sample yet)

INSERT INTO test_orders (order_number, patient_id, doctor_id, order_date, status, notes) VALUES
('ORD-20240120-001', 1, 4, '2024-01-20 08:00:00', 'completed',        'Routine annual check-up'),
('ORD-20240205-002', 2, 4, '2024-02-05 09:00:00', 'in_progress',      'Patient complaints of fatigue and frequent urination'),
('ORD-20240310-003', 3, 5, '2024-03-10 10:00:00', 'sample_collected', 'Pre-employment medical screening'),
('ORD-20240715-004', 1, 5, '2024-07-15 07:30:00', 'requested',        'Follow-up thyroid check');

-- ─────────────────────────────────────────
-- 7. ORDER_ITEMS
-- ─────────────────────────────────────────
-- Order 1: FBC + Hb
INSERT INTO order_items (order_id, test_id) VALUES (1, 1), (1, 2);
-- Order 2: FBS + Creatinine
INSERT INTO order_items (order_id, test_id) VALUES (2, 3), (2, 4);
-- Order 3: HIV + TSH
INSERT INTO order_items (order_id, test_id) VALUES (3, 5), (3, 6);
-- Order 4: TSH only
INSERT INTO order_items (order_id, test_id) VALUES (4, 6);

-- ─────────────────────────────────────────
-- 8. SAMPLES  (for orders 1, 2, 3 — order 4 not yet collected)
-- ─────────────────────────────────────────
INSERT INTO samples (sample_code, order_id, collected_by_user_id, sample_type, collected_at) VALUES
('SPL-20240120-001', 1, 2, 'Blood',  '2024-01-20 08:30:00'),
('SPL-20240205-001', 2, 2, 'Blood',  '2024-02-05 09:15:00'),
('SPL-20240310-001', 3, 3, 'Blood',  '2024-03-10 10:30:00');

-- ─────────────────────────────────────────
-- 9. TEST_RESULTS
--    Order 1 items (id=1 FBC, id=2 Hb) — BOTH VERIFIED (FBC abnormal_low)
--    Order 2 items (id=3 FBS, id=4 Creatinine) — FBS entered unverified, Creatinine none
--    Order 3, 4 — no results yet
-- ─────────────────────────────────────────

-- Result for order_item 1 (FBC) — VERIFIED, ABNORMAL LOW (leukopenia)
INSERT INTO test_results
  (order_item_id, sample_id, result_value, unit, flag, verified, entered_by, entered_at, verified_by, verified_at, notes)
VALUES
(1, 1, '3200', 'cells/µL', 'abnormal_low', 1,
 2, '2024-01-20 10:00:00',
 2, '2024-01-20 11:30:00',
 'Leukopenia noted. Recommend repeat in 2 weeks. Monitor for infections.');

-- Result for order_item 2 (Hb) — VERIFIED, NORMAL
INSERT INTO test_results
  (order_item_id, sample_id, result_value, unit, flag, verified, entered_by, entered_at, verified_by, verified_at, notes)
VALUES
(2, 1, '13.5', 'g/dL', 'normal', 1,
 2, '2024-01-20 10:05:00',
 2, '2024-01-20 11:32:00',
 'Haemoglobin within normal range.');

-- Result for order_item 3 (FBS) — ENTERED, NOT YET VERIFIED (abnormal high)
INSERT INTO test_results
  (order_item_id, sample_id, result_value, unit, flag, verified, entered_by, entered_at, notes)
VALUES
(3, 2, '7.8', 'mmol/L', 'abnormal_high', 0,
 2, '2024-02-05 11:00:00',
 'Elevated fasting glucose. Pending technician verification.');
-- order_item 4 (Creatinine) has no result yet — awaiting entry
