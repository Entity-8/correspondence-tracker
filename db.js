import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createClient } from '@libsql/client';

export const DEPARTMENT_NAMES = [
  'رئيس المكتب السياسي',
  'نائب رئيس المكتب السياسي',
  'مدير مكتب رئيس المكتب السياسي',
  'معاون مدير مكتب رئيس المكتب السياسي',
  'امانة السر لمدير مكتب رئيس المكتب السياسي',
  'شؤون المواطنين',
  'المعاونية السياسية',
  'المعاونية التشريعية',
  'المعاونية الانتخابية',
  'المعاونية الحكومية',
  'المعاونية القضائية',
  'الموارد البشرية',
  'المالية',
  'الامانة العامة وشؤون المحافظات',
  'المكتب التنفيذي',
  'الاعلام السياسي',
  'الشؤون القانونية',
  'الشؤون الادارية والمالية لمدير مكتب رئيس المكتب السياسي',
  'قسم التخطيط في الامانة العامة',
];

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations(id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS departments(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    is_head_office INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    department_id INTEGER,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(department_id) REFERENCES departments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS correspondence_records(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_number TEXT,
    letter_date TEXT NOT NULL,
    sender_department_id INTEGER NOT NULL,
    recipient_department_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    urgency TEXT NOT NULL,
    due_date_in_letter TEXT,
    linked_record_id INTEGER,
    registered_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    stage TEXT,
    not_done_reason TEXT,
    reply_reference TEXT,
    reply_date TEXT,
    confirmed_at TEXT,
    created_by_user_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(sender_department_id) REFERENCES departments(id),
    FOREIGN KEY(recipient_department_id) REFERENCES departments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS record_status_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    changed_at TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    old_stage TEXT,
    new_stage TEXT,
    note TEXT,
    old_version INTEGER NOT NULL,
    new_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attachments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(record_id) REFERENCES correspondence_records(id),
    FOREIGN KEY(uploaded_by_user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS comments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    record_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT,
    scheduled_for TEXT,
    deduplication_key TEXT UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS reminders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    sent_by_user_id INTEGER NOT NULL,
    recipient_department_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_exports(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_by_user_id INTEGER NOT NULL,
    report_type TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_records_status ON correspondence_records(status)`,
  `CREATE INDEX IF NOT EXISTS idx_records_due_at ON correspondence_records(due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_records_sender ON correspondence_records(sender_department_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_recipient ON correspondence_records(recipient_department_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_letter_date ON correspondence_records(letter_date)`,
  `CREATE INDEX IF NOT EXISTS idx_history_record ON record_status_history(record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_record ON comments(record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at)`,
];

const now = () => new Date().toISOString();

function normalizeRow(row) {
  if (!row) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

/**
 * Create an async database adapter backed by either Turso (@libsql/client)
 * when TURSO_DATABASE_URL is configured, or local node:sqlite otherwise.
 */
export function createDatabase(dbPath = process.env.DB_PATH || 'app.db', options = {}) {
  const tursoUrl = options.tursoUrl ?? process.env.TURSO_DATABASE_URL;
  const tursoAuthToken = options.tursoAuthToken ?? process.env.TURSO_AUTH_TOKEN;

  let q;
  let transaction;
  let close;
  let readyPromise = null;
  let initFn = null;

  if (tursoUrl) {
    const client = createClient({
      url: tursoUrl,
      ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
    });

    const wrapExecutor = exec => ({
      one: async (sql, ...args) => {
        const res = await exec.execute({ sql, args });
        return normalizeRow(res.rows[0]);
      },
      all: async (sql, ...args) => {
        const res = await exec.execute({ sql, args });
        return res.rows.map(normalizeRow);
      },
      run: async (sql, ...args) => {
        const res = await exec.execute({ sql, args });
        return {
          lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : 0,
          changes: res.rowsAffected ?? 0,
        };
      },
      now,
    });

    q = wrapExecutor(client);

    transaction = async fn => {
      const tx = await client.transaction('write');
      try {
        const result = await fn(wrapExecutor(tx));
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // Ignore rollback failure on already closed tx
        }
        throw err;
      }
    };

    close = () => client.close();

    initFn = async () => {
      await client.execute('PRAGMA foreign_keys = ON');
      await client.batch(
        SCHEMA_STATEMENTS.map(sql => ({ sql, args: [] })),
        'write',
      );
      await seedDatabase(q, transaction, options);
    };

    readyPromise = initFn().catch(err => {
      readyPromise = null;
      throw err;
    });
  } else {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    if (dbPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      db.exec('PRAGMA busy_timeout = 5000');
    }
    for (const stmt of SCHEMA_STATEMENTS) {
      db.exec(stmt);
    }

    q = {
      one: async (sql, ...args) => normalizeRow(db.prepare(sql).get(...args)),
      all: async (sql, ...args) => db.prepare(sql).all(...args).map(normalizeRow),
      run: async (sql, ...args) => {
        const info = db.prepare(sql).run(...args);
        return {
          lastInsertRowid: Number(info.lastInsertRowid ?? 0),
          changes: Number(info.changes ?? 0),
        };
      },
      now,
    };

    transaction = async fn => {
      db.exec('BEGIN');
      try {
        const result = await fn(q);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };

    close = () => db.close();

    readyPromise = seedDatabase(q, transaction, options);
  }

  return {
    q,
    transaction,
    ensureReady: () => {
      if (!readyPromise && initFn) {
        readyPromise = initFn().catch(err => {
          readyPromise = null;
          throw err;
        });
      }
      return readyPromise;
    },
    close: async () => {
      await readyPromise?.catch(() => {});
      close();
    },
  };
}

async function seedDatabase(q, transaction, options = {}) {
  const demoMode =
    options.demoMode ??
    (process.env.DEMO_MODE === 'true' ||
      (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false'));
  const seedRecords =
    options.seedRecords ?? (demoMode && process.env.SEED_DEMO_RECORDS !== 'false');

  if (!(await q.one('SELECT id FROM departments LIMIT 1'))) {
    await transaction(async tx => {
      for (let i = 0; i < DEPARTMENT_NAMES.length; i++) {
        await tx.run(
          'INSERT OR IGNORE INTO departments(id,name,role,is_head_office) VALUES(?,?,?,?)',
          i + 1,
          DEPARTMENT_NAMES[i],
          i < 4 ? 'Supervisor' : i === 4 ? 'Registrar' : 'Unit',
          i < 5 ? 1 : 0,
        );
      }
    });
  }

  if (!(await q.one('SELECT id FROM users LIMIT 1'))) {
    if (demoMode) {
      const accounts = [
        ['admin', 'Admin123!', 'مدير النظام', null, 'System admin'],
        ['head', 'Head123!', DEPARTMENT_NAMES[0], 1, 'Supervisor'],
        ['deputy', 'Deputy123!', DEPARTMENT_NAMES[1], 2, 'Supervisor'],
        ['director', 'Director123!', DEPARTMENT_NAMES[2], 3, 'Supervisor'],
        ['vicedirector', 'Vice123!', DEPARTMENT_NAMES[3], 4, 'Supervisor'],
        ['registrar', 'Registrar123!', DEPARTMENT_NAMES[4], 5, 'Registrar'],
      ];
      for (let i = 6; i <= 19; i++) {
        accounts.push([
          `unit${String(i).padStart(2, '0')}`,
          'Unit123!',
          DEPARTMENT_NAMES[i - 1],
          i,
          'Unit',
        ]);
      }
      await transaction(async tx => {
        for (const [u, p, n, d, r] of accounts) {
          await tx.run(
            'INSERT OR IGNORE INTO users(username,password_hash,display_name,department_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            u,
            bcrypt.hashSync(p, 10),
            n,
            d,
            r,
            now(),
            now(),
          );
        }
      });
    } else {
      const initialPassword =
        process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(12).toString('base64url');
      await q.run(
        'INSERT OR IGNORE INTO users(username,password_hash,display_name,department_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        'admin',
        bcrypt.hashSync(initialPassword, 10),
        'مدير النظام',
        null,
        'System admin',
        now(),
        now(),
      );
      if (!process.env.ADMIN_INITIAL_PASSWORD && !options.quiet) {
        console.log(
          `[bootstrap] Created initial System admin account: username="admin" password="${initialPassword}"`,
        );
      }
    }
  }

  if (seedRecords && !(await q.one('SELECT id FROM correspondence_records LIMIT 1'))) {
    const firstUser = await q.one('SELECT id FROM users ORDER BY id LIMIT 1');
    const creatorId = firstUser?.id || 1;

    await transaction(async tx => {
      const addRecord = async (
        ref,
        date,
        sender,
        recipient,
        subject,
        urgency,
        status,
        due,
        stage = null,
        reason = null,
      ) => {
        const created = now();
        const info = await tx.run(
          `INSERT INTO correspondence_records(reference_number,letter_date,sender_department_id,
            recipient_department_id,subject,urgency,due_date_in_letter,registered_at,due_at,status,stage,not_done_reason,
            created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ref,
          date,
          sender,
          recipient,
          subject,
          urgency,
          null,
          created,
          due,
          status,
          stage,
          reason,
          creatorId,
          created,
        );
        await tx.run(
          `INSERT INTO record_status_history(record_id,changed_at,user_id,department_id,new_status,new_stage,note,old_version,new_version)
            VALUES(?,?,?,?,?,?,?,?,?)`,
          info.lastInsertRowid,
          created,
          creatorId,
          sender,
          status,
          stage,
          reason,
          0,
          1,
        );
        return info.lastInsertRowid;
      };

      const day = 86400000;
      const base = Date.now();
      const ids = [];
      ids.push(await addRecord('م ب/001', '2025-01-10', 5, 6, 'خطة العمل السنوية', 'عاجل', 'pending', new Date(base - day * 2).toISOString()));
      ids.push(await addRecord('م ب/002', '2025-01-11', 5, 7, 'توجيه بشأن المشاريع', 'عاجل وعلى الفور', 'in_progress', new Date(base + day).toISOString(), 'قيد إعداد الرد'));
      ids.push(await addRecord('م ب/003', '2025-01-12', 5, 8, 'طلب تقرير الأداء', 'عادي', 'reported_done', new Date(base - day).toISOString(), '', ''));
      ids.push(await addRecord('م ب/004', '2025-01-13', 5, 9, 'تعميم إداري', 'عادي', 'not_done', new Date(base - day * 4).toISOString(), null, 'تعذر التنفيذ لعدم توفر البيانات'));
      ids.push(await addRecord('و ح/005', '2025-01-14', 6, 10, 'تنسيق بين الوحدات', 'عاجل جدا', 'pending', new Date(base + day * 2).toISOString()));
      ids.push(await addRecord('و ح/006', '2025-01-15', 7, 6, 'ملاحظات فنية', 'عادي', 'confirmed_done', new Date(base - day * 3).toISOString()));
      ids.push(await addRecord('م ب/007', '2025-01-16', 5, 11, 'تحديث السجلات', 'عاجل', 'not_done', new Date(base - day).toISOString(), null, 'يحتاج إلى موافقة إضافية'));
      ids.push(await addRecord('و ح/008', '2025-01-17', 12, 13, 'تنفيذ مبادرة مشتركة', 'عادي', 'pending', new Date(base + day * 5).toISOString()));
      ids.push(await addRecord('م ب/009', '2025-01-18', 5, 14, 'مذكرة للمتابعة', 'عاجل وعلى الفور', 'in_progress', new Date(base + day).toISOString(), 'تمت مخاطبة الجهة المختصة'));
      ids.push(await addRecord('م ب/010', '2025-01-19', 5, 15, 'بيانات إحصائية', 'عاجل جدا', 'reported_done', new Date(base + day).toISOString(), 'تم جمع البيانات'));
      ids.push(await addRecord('م ب/011', '2025-01-20', 5, 16, 'إجراء عاجل', 'عاجل وعلى الفور', 'pending', new Date(base + day).toISOString()));
      ids.push(await addRecord('و ح/012', '2025-01-21', 16, 17, 'تنسيق داخلي', 'عادي', 'pending', new Date(base + day * 5).toISOString()));
      ids.push(await addRecord('م ب/013', '2025-01-22', 5, 18, 'خطة التدريب', 'عادي', 'confirmed_done', new Date(base - day).toISOString()));
      ids.push(await addRecord('م ب/014', '2025-01-23', 5, 19, 'تعليمات حفظ الوثائق', 'عاجل', 'pending', new Date(base + day * 2).toISOString()));
      ids.push(await addRecord(null, '2025-01-24', 6, 12, 'مراسلة بلا رقم مرجعي', 'عادي', 'pending', new Date(base + day * 5).toISOString()));

      const unit = await tx.one('SELECT id FROM users WHERE username=?', 'unit06');
      await tx.run('UPDATE correspondence_records SET linked_record_id=? WHERE id=?', ids[0], ids[4]);
      await tx.run('UPDATE correspondence_records SET linked_record_id=? WHERE id=?', ids[0], ids[7]);
      await tx.run('UPDATE correspondence_records SET reply_date=? WHERE id=?', '2025-02-01', ids[5]);
      await tx.run('UPDATE correspondence_records SET confirmed_at=? WHERE id=?', new Date(base - day).toISOString(), ids[5]);
      if (unit) {
        await tx.run(
          'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
          unit.id,
          ids[0],
          'creation',
          'كتاب جديد',
          'تم تسجيل كتاب جديد للمتابعة',
          now(),
        );
        await tx.run(
          'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
          unit.id,
          ids[3],
          'reminder',
          'تذكير بالموعد',
          'يوجد كتاب متأخر يحتاج إلى إجراء',
          now(),
        );
      }
    });
  }
}
