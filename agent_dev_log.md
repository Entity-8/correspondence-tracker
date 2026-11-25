# Agent Development Log

## Project: Correspondence Tracker (Public Release Hardening, Backend & UI Polish)
- **Date**: 2026-11-18
- **Lead Developer**: User
- **Co-Pilot**: Antigravity Agent

---

### Entry 01: Public-Release Security Audit & Remediation
**Findings**:
- Private TLS keys (`certs/ca.key`, `certs/server.key`), live SQLite DB (`app.db` with 15 sessions), uploaded files (`uploads/`), `.khoarzmi*` metadata, `server.log`, APK build, and hardcoded public/LAN IPs were present in the working directory.
- `GET /api/records/:id/comments` lacked `visible()` authorization checks (IDOR).
- Session tokens were passed via `?token=` query parameters in image and Excel download URLs.
- Attachment uploads trusted client-supplied `mime` without magic-byte verification.
- `xlsx@0.18.5` had unpatched high-severity CVEs.
- `RecordDetailsPage.jsx` had a React stale-state bug when marking `not_done` via `prompt()`, and `AppShell.jsx` exposed correspondence routes to `System admin`.

**Decisions & Actions Taken**:
1. **License & Public Repo Hygiene**:
   - Added MIT [`LICENSE`](LICENSE), [`SECURITY.md`](SECURITY.md), [`.env.example`](.env.example), [`.env.android.example`](.env.android.example), [`.gitignore`](.gitignore), [`.dockerignore`](.dockerignore), [`Dockerfile`](Dockerfile), and [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
   - Removed private keys, runtime DB/uploads/logs, APK, generator metadata, and hardcoded server IPs from `src/config.js` and `android/app/src/main/res/xml/network_security_config.xml`.
2. **Backend Architecture & Security Hardening**:
   - Replaced `xlsx` with `exceljs` (`server/utils/excel.js`) for CVE-free, styled RTL `.xlsx` exports and ran `npm audit fix` (0 high/critical vulnerabilities in production dependencies).
   - Modularized backend under `server/` (`app.js`, `constants.js`, `middleware/auth.js`, `routes/{auth,records,notifications,reports,admin}.js`, `utils/{validation,excel}.js`).
   - Added `helmet` (CSP + security headers), `express-rate-limit` (login & API), `PRAGMA journal_mode = WAL` + `busy_timeout = 5000` + indexes in `db.js`, magic-byte validation (`detectImageMime`), `?token=` removal, `GET /api/records/:id/comments` IDOR fix, `linked_record_id` creation support, pagination on `GET /api/records`, `POST /api/auth/change-password`, and `DEMO_MODE` gating for demo seeding.
3. **Frontend UX & Bug Fixes**:
   - Kept the Political Bureau Arabic RTL domain intact while gating demo quick-login pills on `demo_mode`.
   - Fixed `System admin` navigation/default landing route (`#admin`) and added a Change Password modal in `AppShell.jsx`.
   - Replaced native `prompt()` dialogs in `RecordDetailsPage.jsx` with in-app modals (fixing the `not_done` stale-state bug), added `<AuthorizedImage>` using `apiBlob()` instead of `?token=`, and surfaced linked parent/child records.
   - Added pagination, date range, and overdue filters to `RecordsPage.jsx`; `linked_record_id` and removable file chips to `NewRecordPage.jsx`; summary totals and `apiBlob()` export to `ReportsPage.jsx`; and `ErrorBoundary` in `App.jsx`.
4. **Verification**:
   - Added `tests/api.test.js` (8 integration tests using `node:test`).
   - Verified `npm run build`, `npm test` (8/8 passing), and `npm audit --omit=dev` (0 high/critical).

---

### Entry 02: Vercel Serverless Migration (Turso + Vercel Blob) & Public Release
**Date**: 2026-11-25
**Actions**:
- Refactored [`db.js`](db.js) and all [`server/`](server) middleware/routes to an async dual-mode database layer supporting **Turso (`@libsql/client`)** when `TURSO_DATABASE_URL` is set, and local `node:sqlite` otherwise.
- Added [`server/utils/storage.js`](server/utils/storage.js) supporting **Vercel Blob (`@vercel/blob`, `access: 'private'`)** when `BLOB_READ_WRITE_TOKEN` is set, falling back to local disk storage.
- Added [`api/index.js`](api/index.js) and [`vercel.json`](vercel.json) for Vercel serverless routing alongside Vite `dist/` static output.
- Provisioned Vercel project `correspondence-tracker`, private Blob store `correspondence-tracker-attachments`, and Turso integration on Vercel (`DEMO_MODE=false`, public access).
- Verified `npm run build` and `npm test` (8/8 passing).
