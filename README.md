# منظومة متابعة المراسلات الرسمية (Correspondence Tracker)

A full-stack Arabic RTL correspondence tracking and follow-up application built with **Node.js 22 (Express + `node:sqlite`)**, **React 18 + Vite**, **ExcelJS** reporting, and optional **Capacitor Android** mobile packaging.

Designed for managing official letters, directives, urgency-based deadlines, overdue monitoring, immutable audit trails, notifications, and department performance reports across a 19-department Political Bureau hierarchy.

---

## Key Features

- **Role-Based Access Control (RBAC)**:
  - **Supervisor** (Head Office leadership): Full visibility across all correspondence, KPI dashboards, department summaries, reports, and formal reminders.
  - **Registrar** (`أمانة السر`): Registers head-office directives, confirms or returns reported completions, sends reminders, and exports reports.
  - **Unit** (`الجهات التنفيذية`): Registers outgoing unit correspondence, views own workload, updates progress stages, reports completion with reply references, or logs inability to complete.
  - **System admin**: Manages user accounts, password resets, and department activation—strictly isolated from correspondence records and comments.
- **Automated Deadlines & Overdue Tracking**:
  - `عاجل وعلى الفور` (24h), `عاجل جدا` (48h), `عاجل` (72h), `عادي` (5 days or letter-specified date).
- **Workflow & Immutable Audit History**:
  - Optimistic concurrency control (`version`), linked parent/child records, internal comments, formal reminders, and full status transition history.
- **Document Attachments**:
  - Image uploads (JPEG/PNG/WebP up to 10 MB, max 5 per upload) with server-side magic-byte verification and authenticated blob previews.
- **Reports & Styled RTL Excel Export**:
  - Overdue letters, non-completed letters, and date-filtered department performance summaries exported to `.xlsx` via `exceljs`.
- **Security Hardening**:
  - `helmet` CSP & security headers, `express-rate-limit` on login and API endpoints, `bcryptjs` password hashing, `HttpOnly` cookies / `Bearer` tokens, SQLite WAL mode with `busy_timeout`, and production bootstrap without hardcoded demo credentials.

---

## Tech Stack

- **Backend**: Node.js `>=22`, Express 4, `node:sqlite` (WAL mode), `helmet`, `express-rate-limit`, `bcryptjs`, `exceljs`
- **Frontend**: React 18, Vite 5, Arabic RTL CSS Design System (`Cairo` font)
- **Mobile (Optional)**: Capacitor 8 (`@capacitor/android`)
- **Migration Tooling**: Python 3 SQLite-to-MSSQL T-SQL generator ([`convert_mssql.py`](convert_mssql.py))

---

## Quick Start

### Prerequisites

- **Node.js 22+** (required for built-in `node:sqlite`)
- **npm 10+**

### 1. Install & Build

```bash
npm ci
cp .env.example .env
npm run build
```

### 2. Run

```bash
npm start
```

Open `http://localhost:3000`.

In development (`DEMO_MODE=true`), the database seeds 19 departments, demo accounts, and 15 sample correspondence records, and displays quick-select demo buttons on the login screen.

> **Production Note:** Set `NODE_ENV=production` and `DEMO_MODE=false`. On first start without existing users, only a single `admin` account is created using `ADMIN_INITIAL_PASSWORD` (or a generated one-time password printed once to stdout).

### 3. Run Tests

```bash
npm test
```

---

## Environment Variables

See [`.env.example`](.env.example):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` in deployment |
| `PORT` | `3000` | HTTP listen port |
| `HTTPS_PORT` | `3443` | HTTPS listen port (active when TLS key/cert exist) |
| `DB_PATH` | `app.db` | SQLite database file path |
| `UPLOADS_DIR` | `uploads` | Directory for uploaded attachments |
| `DEMO_MODE` | `true` in dev, `false` in prod | Controls demo seeding and login quick-fill pills |
| `SEED_DEMO_RECORDS` | follows `DEMO_MODE` | Seeds sample correspondence records on empty DB |
| `ADMIN_INITIAL_PASSWORD` | random | Initial `admin` password when `DEMO_MODE=false` |
| `CORS_ORIGINS` | — | Comma-separated extra allowed origins |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy (Nginx/Caddy) |
| `SSL_KEY` / `SSL_CERT` | `certs/server.key` / `certs/server.crt` | Optional TLS files for direct Node HTTPS |

---

## Vercel Serverless Deployment

The repository includes [`api/index.js`](api/index.js) and [`vercel.json`](vercel.json) for serverless deployment on Vercel using **Turso** (`@libsql/client`) and **Vercel Blob** (`@vercel/blob`, private access):

1. Provision a **Turso** database (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and a private **Vercel Blob** store (`BLOB_READ_WRITE_TOKEN`).
2. Set `DEMO_MODE=false` and `ADMIN_INITIAL_PASSWORD` in your Vercel project environment variables.
3. Deploy via Git integration or `vercel --prod`.

---

## Docker

```bash
docker build -t correspondence-tracker .
docker run -d -p 3000:3000 \
  -e NODE_ENV=production \
  -e DEMO_MODE=false \
  -e ADMIN_INITIAL_PASSWORD="ChangeMeNow!2026" \
  -v ct_data:/app/data \
  -v ct_uploads:/app/uploads \
  correspondence-tracker
```

---

## Project Structure

```text
├── server.js                  # HTTP/HTTPS server entrypoint & graceful shutdown
├── db.js                      # SQLite schema, WAL pragmas, indexes & seed logic
├── server/
│   ├── app.js                 # Express app, Helmet, CORS, rate limiters, error handling
│   ├── constants.js           # Roles, urgencies, statuses, upload limits
│   ├── middleware/auth.js     # Session auth, RBAC guards, record visibility
│   ├── routes/                # auth, records, notifications, reports, admin
│   └── utils/                 # Date/magic-byte validation & ExcelJS RTL export
├── src/
│   ├── App.jsx                # Root app + ErrorBoundary
│   ├── api.js                 # Authenticated JSON & Blob fetch helpers
│   ├── config.js              # API base URL & token storage
│   ├── styles.css             # Arabic RTL executive design system
│   └── components/            # Dashboard, Records, Details, NewRecord, Reports, Admin
├── tests/api.test.js          # End-to-end API integration test suite
├── convert_mssql.py           # Optional SQLite -> MS SQL Server T-SQL generator
├── Dockerfile                 # Multi-stage production container
└── android/                   # Capacitor Android project
```

---

## Android APK (Optional)

1. Copy `.env.android.example` to `.env.android` and set `VITE_API_BASE` to your HTTPS server URL.
2. Ensure JDK 17+ and Android SDK are configured (`ANDROID_HOME`).
3. Build:

```bash
npm run apk
```

---

## SQL Server Migration (Optional)

To export a populated SQLite database to a T-SQL migration script for Microsoft SQL Server:

```bash
npm run convert:mssql
sqlcmd -S <server> -U <user> -P <password> -d <database> -i mssql_migration.sql
```

---

## License

Released under the [MIT License](LICENSE).
