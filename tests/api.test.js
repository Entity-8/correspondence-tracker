import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../db.js';
import { createApp } from '../server/app.js';

// Minimal valid 1x1 PNG buffer
const VALID_PNG_B64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]).toString('base64');

async function reqJson(baseUrl, urlPath, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

async function login(baseUrl, username, password) {
  const res = await reqJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(res.status, 200, `Expected login 200 for ${username}`);
  return res.data.token;
}

describe('Correspondence Tracker API', () => {
  let tmpDir;
  let dbHandle;
  let server;
  let baseUrl;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const uploadsDir = path.join(tmpDir, 'uploads');
    dbHandle = createDatabase(dbPath, { demoMode: true, seedRecords: true });
    await dbHandle.ensureReady();
    const app = createApp({
      dbHandle,
      config: { demoMode: true, uploadsDir, disableRateLimit: true },
    });
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await dbHandle.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns health status, demo config, and HTTP-safe CSP headers', async () => {
    const health = await reqJson(baseUrl, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    const csp = health.headers.get('content-security-policy') || '';
    assert.equal(csp.includes('upgrade-insecure-requests'), false);

    const cfg = await reqJson(baseUrl, '/api/auth/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.data.demo_mode, true);
  });

  it('rejects invalid credentials and prevents query-string token auth', async () => {
    const bad = await reqJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'head', password: 'wrong' },
    });
    assert.equal(bad.status, 401);

    const token = await login(baseUrl, 'head', 'Head123!');
    const queryAuth = await reqJson(baseUrl, `/api/dashboard?token=${token}`);
    assert.equal(queryAuth.status, 401);
  });

  it('blocks System admin from all correspondence endpoints including comments', async () => {
    const adminToken = await login(baseUrl, 'admin', 'Admin123!');

    const dash = await reqJson(baseUrl, '/api/dashboard', { token: adminToken });
    assert.equal(dash.status, 403);

    const list = await reqJson(baseUrl, '/api/records', { token: adminToken });
    assert.equal(list.status, 403);

    const detail = await reqJson(baseUrl, '/api/records/1', { token: adminToken });
    assert.equal(detail.status, 403);

    const comments = await reqJson(baseUrl, '/api/records/1/comments', { token: adminToken });
    assert.equal(comments.status, 403);

    const report = await reqJson(baseUrl, '/api/reports/late', { token: adminToken });
    assert.equal(report.status, 403);
  });

  it('enforces Unit record & comment isolation (prevents IDOR)', async () => {
    const unit6Token = await login(baseUrl, 'unit06', 'Unit123!');
    const unit7Token = await login(baseUrl, 'unit07', 'Unit123!');

    // Record 2 is sent from dept 5 to dept 7
    const ok = await reqJson(baseUrl, '/api/records/2/comments', { token: unit7Token });
    assert.equal(ok.status, 200);

    const forbidden = await reqJson(baseUrl, '/api/records/2/comments', { token: unit6Token });
    assert.equal(forbidden.status, 404);

    // Unit cannot register on behalf of another department
    const spoof = await reqJson(baseUrl, '/api/records', {
      method: 'POST',
      token: unit6Token,
      body: {
        letter_date: '2025-05-01',
        subject: 'Spoof attempt',
        sender_department_id: 7,
        recipient_department_ids: [8],
        urgency: 'عادي',
      },
    });
    assert.equal(spoof.status, 403);
  });

  it('validates image magic bytes on attachment upload and serves with nosniff', async () => {
    const headToken = await login(baseUrl, 'head', 'Head123!');

    const spoofedUpload = await reqJson(baseUrl, '/api/records/1/attachments', {
      method: 'POST',
      token: headToken,
      body: {
        files: [
          {
            name: 'evil.png',
            mime: 'image/png',
            data: Buffer.from('not a real png <script>alert(1)</script>').toString('base64'),
          },
        ],
      },
    });
    assert.equal(spoofedUpload.status, 422);

    const validUpload = await reqJson(baseUrl, '/api/records/1/attachments', {
      method: 'POST',
      token: headToken,
      body: {
        files: [
          {
            name: 'scan.png',
            mime: 'image/png',
            data: `data:image/png;base64,${VALID_PNG_B64}`,
          },
        ],
      },
    });
    assert.equal(validUpload.status, 201);
    const attId = validUpload.data.attachments[0].id;

    const download = await fetch(`${baseUrl}/api/records/1/attachments/${attId}`, {
      headers: { Authorization: `Bearer ${headToken}` },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(download.headers.get('content-type'), 'image/png');
  });

  it('runs end-to-end correspondence lifecycle, optimistic lock, reminder, and Excel export', async () => {
    const registrarToken = await login(baseUrl, 'registrar', 'Registrar123!');
    const unit8Token = await login(baseUrl, 'unit08', 'Unit123!');

    // 1. Registrar creates a linked record for dept 8
    const created = await reqJson(baseUrl, '/api/records', {
      method: 'POST',
      token: registrarToken,
      body: {
        reference_number: 'ت/999',
        letter_date: '2025-05-10',
        sender_department_id: 5,
        recipient_department_ids: [8],
        urgency: 'عاجل',
        subject: 'اختبار دورة حياة المعاملة',
        linked_record_id: 1,
      },
    });
    assert.equal(created.status, 201);
    const recId = created.data.records[0].id;
    assert.equal(created.data.records[0].linked_record_id, 1);

    // 2. Registrar sends reminder
    const rem = await reqJson(baseUrl, `/api/records/${recId}/reminders`, {
      method: 'POST',
      token: registrarToken,
      body: { note: 'يرجى المتابعة' },
    });
    assert.equal(rem.status, 200);

    // 3. Unit 08 updates status with wrong version -> 409
    const conflict = await reqJson(baseUrl, `/api/records/${recId}/status`, {
      method: 'POST',
      token: unit8Token,
      body: { status: 'in_progress', stage: 'بدء العمل', version: 99 },
    });
    assert.equal(conflict.status, 409);

    // 4. Unit 08 updates to in_progress then reported_done
    const prog = await reqJson(baseUrl, `/api/records/${recId}/status`, {
      method: 'POST',
      token: unit8Token,
      body: { status: 'in_progress', stage: 'بدء العمل', version: 1 },
    });
    assert.equal(prog.status, 200);
    assert.equal(prog.data.record.version, 2);

    const rep = await reqJson(baseUrl, `/api/records/${recId}/status`, {
      method: 'POST',
      token: unit8Token,
      body: {
        status: 'reported_done',
        reply_date: '2025-05-11',
        reply_reference: 'ج/12',
        version: 2,
      },
    });
    assert.equal(rep.status, 200);

    // 5. Registrar confirms completion
    const conf = await reqJson(baseUrl, `/api/records/${recId}/confirm`, {
      method: 'POST',
      token: registrarToken,
    });
    assert.equal(conf.status, 200);

    // 6. Export Excel report via ExcelJS
    const xlsxRes = await fetch(
      `${baseUrl}/api/reports/department-summary/export?from=2025-01-01&to=2026-12-31`,
      { headers: { Authorization: `Bearer ${registrarToken}` } },
    );
    assert.equal(xlsxRes.status, 200);
    const bytes = new Uint8Array(await xlsxRes.arrayBuffer());
    assert.equal(bytes[0], 0x50); // 'P'
    assert.equal(bytes[1], 0x4b); // 'K'
  });

  it('supports admin user creation, self-lockout protection, and password change', async () => {
    const adminToken = await login(baseUrl, 'admin', 'Admin123!');

    // Self-deactivation blocked
    const selfDeactivate = await reqJson(baseUrl, '/api/admin/users/1/deactivate', {
      method: 'POST',
      token: adminToken,
    });
    assert.equal(selfDeactivate.status, 422);

    // Create secondary admin
    const createdAdmin = await reqJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      token: adminToken,
      body: {
        username: 'sec_admin',
        display_name: 'مدير ثانوي',
        password: 'StrongPassword1!',
        role: 'System admin',
      },
    });
    assert.equal(createdAdmin.status, 201);

    const secToken = await login(baseUrl, 'sec_admin', 'StrongPassword1!');
    const chg = await reqJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      token: secToken,
      body: {
        current_password: 'StrongPassword1!',
        new_password: 'NewStrongPassword2!',
      },
    });
    assert.equal(chg.status, 200);

    const relogin = await login(baseUrl, 'sec_admin', 'NewStrongPassword2!');
    assert.ok(relogin);
  });

  it('seeds only admin when demoMode is false', async () => {
    const prodDb = createDatabase(':memory:', { demoMode: false, quiet: true });
    await prodDb.ensureReady();
    const users = await prodDb.q.all('SELECT username, role FROM users');
    const records = await prodDb.q.one('SELECT COUNT(*) AS c FROM correspondence_records');
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'admin');
    assert.equal(records.c, 0);
    await prodDb.close();
  });
});

