# LabTrackMS — Laboratory Test Management System

A complete, production-ready full-stack web application for clinical and diagnostic laboratory management, adhering to a three-tier architecture and the **3-Actor Model** (Administrator, Doctor, Laboratory Technician).

---

## Technical Stack

| Component | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Web Framework | Express.js (v5+) |
| Templating Engine | EJS with role-based partial layouts |
| Design System | Flat CSS (`public/css/labtm.css`), solid color tokens (`labtm-*` prefix), Inter font |
| Database | MySQL 8.0 (`mysql2` connection pool, 100% parameterized queries) |
| Auth & Security | `express-session`, `bcrypt` password hashing, role guard middleware |
| Business Logic | Isolated engine layer (`engine/labtmEngine.js`) |
| Containerization | Docker & Docker Compose |

---

## 3-Actor Role System

Per the Use Case Analysis (Fig 3.6.2), the system enforces strict role-based access for three primary actors:

1. **Administrator (`admin`)**
   - User account management (create, edit, soft-delete users; manage doctor specialties)
   - Department CRUD
   - Test catalog CRUD (test name, description, price, turnaround time, numeric reference ranges, units)
   - System analytics & report oversight (TAT tracking, out-of-range rates, department volume)
   - CSV exports for system performance data
   - **Exclusive Privilege**: Patient record deletion (Technicians and Doctors CANNOT delete patient records)

2. **Doctor (`doctor`)**
   - Patient registration with automated duplicate detection (name + DOB / phone matching)
   - Test order creation (selecting patient, multiple tests, clinical notes)
   - Order tracking and result viewing (read-only on test results)
   - Formatted, printable clinical lab reports with print-to-PDF support

3. **Laboratory Technician (`technician`)**
   - Sample collection recording (generating unique sample codes `SPL-YYYYMMDD-NNN`, recording sample types and notes)
   - Result entry (server-side automated reference-range classification: `normal`, `abnormal_high`, `abnormal_low`)
   - Result verification workflow
   - **Verification-Lock Enforcement**: Once a result is verified by a technician (`verified = 1`), it is permanently locked at the application layer. No further edits or deletions are allowed.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js ≥ 18
- MySQL 8.0+

### 1. Database Setup
### 3. Create database & seed

**Option A: Using npm script (Cross-platform — Works on Windows PowerShell, CMD, Mac, Linux)**
```bash
npm run db:setup
```

**Option B: PowerShell command**
```powershell
Get-Content schema.sql | mysql -u root -p
Get-Content seed.sql | mysql -u root -p
```

**Option C: Command Prompt (CMD)**
```cmd
mysql -u root -p < schema.sql
mysql -u root -p < seed.sql
```

### 2. Environment Configuration
Create a `.env` file (or copy `.env.example`):
```env
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=labtm_db
SESSION_SECRET=labtm_super_secret_session_key_2024
APP_NAME=LabTrackMS
```

### 3. Install Dependencies & Run
```bash
npm install
npm start
```
Server runs at `http://localhost:3000`.

---

## Docker Compose Quick Start

To launch both MySQL and the Node.js application in isolated containers:

```bash
docker compose up --build
```

MySQL initialization scripts (`schema.sql` and `seed.sql`) will automatically populate `labtm_db` on first boot.

---

## Default Test Credentials

All accounts use password: `Password@123`

| Role | Name | Email | Password | Home Route |
|---|---|---|---|---|
| **Administrator** | Admin Lawal | `admin@labtm.com` | `Password@123` | `/admin/dashboard` |
| **Doctor** | Dr. Sarah Adeyemi | `doctor1@labtm.com` | `Password@123` | `/doctor/dashboard` |
| **Doctor** | Dr. Yemi Okafor | `doctor2@labtm.com` | `Password@123` | `/doctor/dashboard` |
| **Technician** | Emmanuel Chukwu | `tech1@labtm.com` | `Password@123` | `/technician/dashboard` |
| **Technician** | Ngozi Eze | `tech2@labtm.com` | `Password@123` | `/technician/dashboard` |

---

## Project Structure

```
.
├── app.js                    # Express application entry point & middleware setup
├── config/
│   └── db.js                 # MySQL connection pool wrapper
├── engine/
│   └── labtmEngine.js        # Isolated business logic engine (status transitions, flags, TAT, analytics)
├── middleware/
│   └── auth.js               # Session verification & role guard middleware
├── routes/
│   ├── pages/                # Page-rendering routes
│   │   ├── auth.js           # Login / Logout
│   │   ├── admin.js          # Admin panel, users, catalog, departments, analytics
│   │   ├── doctor.js         # Patient registration, order creation, report viewing
│   │   └── technician.js     # Sample collection, result entry, verification queue
│   └── api/                  # JSON API endpoints
│       ├── patients.js       # Patient lookup & duplicate search API
│       ├── orders.js         # Order status API
│       └── analytics.js      # Dashboard analytics API
├── views/
│   ├── partials/             # Head, navbar, sidebar, flash messages, result-flag badge
│   ├── auth/                 # Login page view
│   ├── admin/                # Admin dashboards & catalog/user management forms
│   ├── doctor/               # Doctor order entry & patient forms
│   ├── technician/           # Lab workbench, sample collect, result entry, verification views
│   └── shared/               # Printable laboratory test report
├── public/
│   ├── css/labtm.css         # Flat CSS design system (Inter font, labtm-* tokens, no gradients)
│   └── js/labtm.js           # Client-side UI behaviors & autocomplete
├── schema.sql                # Complete 9-entity normalized database schema
├── seed.sql                  # Seed data with 5 users, catalog, patients, sample orders & results
├── Dockerfile                # Multi-stage production container build
├── docker-compose.yml        # Docker service definition (App + MySQL 8.0)
└── .env.example              # Environment variables template
```

---

## Database Schema (9 Entities)

1. `users`: Base actor account (`admin`, `doctor`, `technician`).
2. `departments`: Lab departments (`Haematology & Biochemistry`, `Microbiology & Serology`).
3. `doctors`: Extended doctor profiles linked to `users`.
4. `patients`: Demographic data (`patient_unique_id`, name, DOB, gender, phone, address).
5. `test_catalog`: Tests offered, pricing, turnaround time, and numeric reference limits (`reference_low`, `reference_high`, `unit`).
6. `test_orders`: Diagnostic requests initiated by doctors (`order_number`, status lifecycle).
7. `order_items`: Individual test requests within an order.
8. `samples`: Recorded sample collections (`sample_code`, sample type, collection timestamp).
9. `test_results`: Diagnostic values entered by technicians with server-computed flag (`normal`, `abnormal_high`, `abnormal_low`) and `verified` lock status.

---

## Business Logic Engine (`engine/labtmEngine.js`)

All core workflow rules are housed in a dedicated engine layer separate from HTTP route handlers:

- **Server-Side Result Flagging**: Compares result numeric values against `test_catalog.reference_low` and `reference_high`.
- **Verification Lock Rule**: Calling `verifyResult(resultId)` sets `verified = 1`, recording `verified_by` and `verified_at`. Once verified, `assertResultEditable(resultId)` rejects any subsequent edit or delete attempt.
- **Automated Order Lifecycle**: `refreshOrderStatus(orderId)` updates status automatically:
  - `requested` → Order placed, no sample collected.
  - `sample_collected` → Sample code generated, no results entered.
  - `in_progress` → At least one result entered.
  - `completed` → All order items have verified results.
- **Analytics & Turnaround Calculation**: Computes turnaround hours (`verified_at - collected_at`) and compares against target TAT hours, generating out-of-range rates and CSV exports.
