-- ============================================================
-- LabTrackMS Database Schema  v2.0
-- MySQL 8.0+  |  Parameterized queries only  |  9 entities per ERD
-- Roles: admin | doctor | technician
-- ============================================================

CREATE DATABASE IF NOT EXISTS labtm_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE labtm_db;

-- ─────────────────────────────────────────────────────────────────
-- 1. USERS  (base entity — all authenticated actors)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150)     NOT NULL,
  email         VARCHAR(200)     NOT NULL UNIQUE,
  password_hash VARCHAR(255)     NOT NULL,
  role          ENUM('admin','doctor','technician') NOT NULL,
  is_active     TINYINT(1)       NOT NULL DEFAULT 1,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role  (role),
  INDEX idx_users_email (email)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 2. DEPARTMENTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL UNIQUE,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 3. PATIENTS  (data subject; extends users concept per ERD but
--    patient is NOT a logged-in actor in this build)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id                INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  patient_unique_id VARCHAR(20)   NOT NULL UNIQUE,   -- PAT-000001
  name              VARCHAR(150)  NOT NULL,
  date_of_birth     DATE          NOT NULL,
  gender            ENUM('male','female','other') NOT NULL,
  phone             VARCHAR(30)   DEFAULT NULL,
  address           TEXT          DEFAULT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_patients_name (name),
  INDEX idx_patients_dob  (date_of_birth)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 4. DOCTORS  (per ERD doctor entity; references users where role=doctor)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL UNIQUE,
  specialty  VARCHAR(150) DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_doctors_user (user_id)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 5. TEST_CATALOG  (reference_low/reference_high as DECIMAL for
--    programmatic comparison in flagging logic)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_catalog (
  id                      INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  department_id           INT UNSIGNED  NOT NULL,
  test_name               VARCHAR(150)  NOT NULL,
  description             TEXT          DEFAULT NULL,
  price                   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  turnaround_time_hours   SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  reference_low           DECIMAL(12,4) DEFAULT NULL,
  reference_high          DECIMAL(12,4) DEFAULT NULL,
  unit                    VARCHAR(50)   DEFAULT NULL,
  is_active               TINYINT(1)    NOT NULL DEFAULT 1,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  INDEX idx_tc_department (department_id),
  INDEX idx_tc_name       (test_name)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 6. TEST_ORDERS  (doctor requests tests for a patient)
--    Status lifecycle: requested → sample_collected → in_progress → completed
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_orders (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(24)  NOT NULL UNIQUE,              -- ORD-20240722-001
  patient_id INT UNSIGNED NOT NULL,
  doctor_id  INT UNSIGNED NOT NULL,                        -- references users.id where role=doctor
  order_date DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status     ENUM('requested','sample_collected','in_progress','completed','cancelled')
             NOT NULL DEFAULT 'requested',
  notes      TEXT         DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id)  ON DELETE RESTRICT,
  FOREIGN KEY (doctor_id)  REFERENCES users(id)     ON DELETE RESTRICT,
  INDEX idx_to_patient (patient_id),
  INDEX idx_to_doctor  (doctor_id),
  INDEX idx_to_status  (status),
  INDEX idx_to_date    (order_date)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 7. ORDER_ITEMS  (one per test within an order)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id  INT UNSIGNED NOT NULL,
  test_id   INT UNSIGNED NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES test_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id)  REFERENCES test_catalog(id) ON DELETE RESTRICT,
  INDEX idx_oi_order (order_id),
  INDEX idx_oi_test  (test_id)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 8. SAMPLES  (technician records physical sample collection)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS samples (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sample_code           VARCHAR(30)  NOT NULL UNIQUE,   -- SPL-20240722-001
  order_id              INT UNSIGNED NOT NULL,
  collected_by_user_id  INT UNSIGNED NOT NULL,
  sample_type           VARCHAR(100) NOT NULL DEFAULT 'Blood',
  collected_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes                 TEXT         DEFAULT NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id)             REFERENCES test_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (collected_by_user_id) REFERENCES users(id)       ON DELETE RESTRICT,
  INDEX idx_samples_order (order_id),
  INDEX idx_samples_code  (sample_code)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────
-- 9. TEST_RESULTS  (technician enters result per order_item)
--    verified BOOLEAN + verified_by/at enforce the lock rule:
--    once verified=TRUE no further edits/deletes are allowed at app layer.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_results (
  id            INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  order_item_id INT UNSIGNED  NOT NULL UNIQUE,           -- 1 result per order_item
  sample_id     INT UNSIGNED  NOT NULL,
  result_value  VARCHAR(255)  NOT NULL,
  unit          VARCHAR(50)   DEFAULT NULL,
  flag          ENUM('normal','abnormal_high','abnormal_low') DEFAULT NULL,
  verified      TINYINT(1)    NOT NULL DEFAULT 0,
  entered_by    INT UNSIGNED  NOT NULL,
  entered_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by   INT UNSIGNED  DEFAULT NULL,
  verified_at   DATETIME      DEFAULT NULL,
  notes         TEXT          DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (sample_id)     REFERENCES samples(id)     ON DELETE RESTRICT,
  FOREIGN KEY (entered_by)    REFERENCES users(id)        ON DELETE RESTRICT,
  FOREIGN KEY (verified_by)   REFERENCES users(id)        ON DELETE SET NULL,
  INDEX idx_tr_order_item (order_item_id),
  INDEX idx_tr_sample     (sample_id),
  INDEX idx_tr_verified   (verified)
) ENGINE=InnoDB;
