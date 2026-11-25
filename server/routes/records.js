import express from 'express';
import {
  ALLOWED_IMAGE_MIMES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  STATUSES,
  URGENCIES,
} from '../constants.js';
import {
  detectImageMime,
  isIsoDate,
  parsePositiveInt,
  sanitizeFilename,
  sendError,
} from '../utils/validation.js';

export function enrichRecord(r) {
  const now = new Date();
  const due = new Date(r.due_at);
  return {
    ...r,
    is_overdue: r.status !== 'confirmed_done' && due < now,
    is_late_confirmation:
      r.status === 'confirmed_done' &&
      Boolean(r.confirmed_at) &&
      new Date(r.confirmed_at) > due,
  };
}

function computeDueDate(urgency, dueDateInLetter, registered) {
  const ms = registered.getTime();
  if (urgency === 'عاجل وعلى الفور') return new Date(ms + 86400000);
  if (urgency === 'عاجل جدا') return new Date(ms + 172800000);
  if (urgency === 'عاجل') return new Date(ms + 259200000);
  if (dueDateInLetter) return new Date(`${dueDateInLetter}T23:59:59.000Z`);
  return new Date(ms + 432000000);
}

export function createRecordsRouter({ q, transaction, authHelpers, storage }) {
  const router = express.Router();
  const { requireAuth, requireRoles, denyAdmin, canViewRecord } = authHelpers;

  router.get('/departments', requireAuth, async (req, res) => {
    try {
      res.json(await q.all('SELECT * FROM departments WHERE is_active = 1 ORDER BY id'));
    } catch (err) {
      console.error('departments error:', err);
      sendError(res, 500, 'تعذر تحميل الإدارات');
    }
  });

  router.get('/dashboard', requireAuth, denyAdmin, async (req, res) => {
    try {
      let where = '';
      let args = [];
      if (req.user.role === 'Unit') {
        where = 'WHERE r.sender_department_id = ? OR r.recipient_department_id = ?';
        args = [req.user.department_id, req.user.department_id];
      } else if (req.user.role === 'Registrar') {
        where = 'WHERE s.is_head_office = 1 OR r.recipient_department_id = ?';
        args = [req.user.department_id];
      }

      const rawRecords = await q.all(
        `SELECT r.*, s.name AS sender_name, t.name AS recipient_name
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         JOIN departments t ON t.id = r.recipient_department_id
         ${where}
         ORDER BY r.due_at ASC`,
        ...args,
      );
      const records = rawRecords.map(enrichRecord);

      const counts = Object.fromEntries(
        STATUSES.map(st => [st, records.filter(r => r.status === st).length]),
      );

      const summary =
        req.user.role === 'Unit'
          ? []
          : await q.all(
              `SELECT d.id, d.name,
                COUNT(r.id) AS total,
                SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN r.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN r.status = 'reported_done' THEN 1 ELSE 0 END) AS reported_done,
                SUM(CASE WHEN r.status = 'confirmed_done' THEN 1 ELSE 0 END) AS confirmed_done,
                SUM(CASE WHEN r.status = 'not_done' THEN 1 ELSE 0 END) AS not_done,
                SUM(CASE WHEN r.status != 'confirmed_done' AND r.due_at < ? THEN 1 ELSE 0 END) AS overdue
               FROM departments d
               LEFT JOIN correspondence_records r ON d.id = r.recipient_department_id
               GROUP BY d.id
               ORDER BY d.id`,
              q.now(),
            );

      res.json({
        counts,
        total: records.length,
        overdue: records.filter(r => r.is_overdue).length,
        open_records: records.filter(r => r.status !== 'confirmed_done').slice(0, 8),
        overdue_records: records.filter(r => r.is_overdue).slice(0, 10),
        summary,
      });
    } catch (err) {
      console.error('dashboard error:', err);
      sendError(res, 500, 'تعذر تحميل لوحة المتابعة');
    }
  });

  router.get('/records', requireAuth, denyAdmin, async (req, res) => {
    try {
      const params = [];
      const clauses = [];

      if (req.user.role === 'Unit') {
        clauses.push('(r.sender_department_id = ? OR r.recipient_department_id = ?)');
        params.push(req.user.department_id, req.user.department_id);
      } else if (req.user.role === 'Registrar') {
        clauses.push('(s.is_head_office = 1 OR r.recipient_department_id = ?)');
        params.push(req.user.department_id);
      }

      if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const term = `%${req.query.search.trim()}%`;
        clauses.push('(r.reference_number LIKE ? OR r.subject LIKE ?)');
        params.push(term, term);
      }

      for (const key of ['sender_department_id', 'recipient_department_id']) {
        if (req.query[key] !== undefined && req.query[key] !== '') {
          const deptId = parsePositiveInt(req.query[key]);
          if (!deptId) return sendError(res, 422, `قيمة ${key} غير صحيحة`);
          clauses.push(`r.${key} = ?`);
          params.push(deptId);
        }
      }

      if (req.query.status) {
        if (!STATUSES.includes(req.query.status)) {
          return sendError(res, 422, 'قيمة status غير صحيحة');
        }
        clauses.push('r.status = ?');
        params.push(req.query.status);
      }

      if (req.query.urgency) {
        if (!URGENCIES.includes(req.query.urgency)) {
          return sendError(res, 422, 'قيمة urgency غير صحيحة');
        }
        clauses.push('r.urgency = ?');
        params.push(req.query.urgency);
      }

      if (req.query.from) {
        if (!isIsoDate(req.query.from)) return sendError(res, 422, 'تاريخ البداية غير صحيح');
        clauses.push('r.letter_date >= ?');
        params.push(req.query.from);
      }

      if (req.query.to) {
        if (!isIsoDate(req.query.to)) return sendError(res, 422, 'تاريخ النهاية غير صحيح');
        clauses.push('r.letter_date <= ?');
        params.push(req.query.to);
      }

      if (req.query.overdue === 'true' || req.query.overdue === '1') {
        clauses.push("r.status != 'confirmed_done' AND r.due_at < ?");
        params.push(q.now());
      }

      const page = Math.max(1, parsePositiveInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parsePositiveInt(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      const totalRow = await q.one(
        `SELECT COUNT(*) AS total
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         ${whereSql}`,
        ...params,
      );
      const total = totalRow?.total || 0;

      const rawRows = await q.all(
        `SELECT r.*, s.name AS sender_name, t.name AS recipient_name,
          (SELECT COUNT(*) FROM attachments a WHERE a.record_id = r.id) AS attachment_count
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         JOIN departments t ON t.id = r.recipient_department_id
         ${whereSql}
         ORDER BY r.due_at ASC
         LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      );

      res.json({
        records: rawRows.map(enrichRecord),
        total,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err) {
      console.error('records list error:', err);
      sendError(res, 500, 'تعذر تحميل السجلات');
    }
  });

  router.get('/records/:id', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');

    try {
      if (!(await canViewRecord(req.user, id))) {
        return sendError(res, 404, 'السجل غير موجود');
      }

      const record = await q.one(
        `SELECT r.*, s.name AS sender_name, t.name AS recipient_name
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         JOIN departments t ON t.id = r.recipient_department_id
         WHERE r.id = ?`,
        id,
      );
      const comments = await q.all(
        `SELECT c.*, u.display_name, d.name AS department_name
         FROM comments c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN departments d ON d.id = c.department_id
         WHERE c.record_id = ?
         ORDER BY c.id`,
        id,
      );
      const audit = await q.all(
        `SELECT h.*, u.display_name, d.name AS department_name
         FROM record_status_history h
         JOIN users u ON u.id = h.user_id
         LEFT JOIN departments d ON d.id = h.department_id
         WHERE h.record_id = ?
         ORDER BY h.id`,
        id,
      );
      const attachments = await q.all(
        `SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.display_name AS uploaded_by
         FROM attachments a
         JOIN users u ON u.id = a.uploaded_by_user_id
         WHERE a.record_id = ?
         ORDER BY a.id`,
        id,
      );

      const linkedRecord =
        record.linked_record_id && (await canViewRecord(req.user, record.linked_record_id))
          ? await q.one(
              'SELECT id, reference_number, subject FROM correspondence_records WHERE id = ?',
              record.linked_record_id,
            )
          : null;

      const rawChildren = await q.all(
        'SELECT id, reference_number, subject, status FROM correspondence_records WHERE linked_record_id = ?',
        id,
      );
      const children = [];
      for (const child of rawChildren) {
        if (await canViewRecord(req.user, child.id)) children.push(child);
      }

      res.json({
        record: enrichRecord(record),
        attachments,
        comments,
        audit,
        linked_record: linkedRecord,
        children,
      });
    } catch (err) {
      console.error('record detail error:', err);
      sendError(res, 500, 'تعذر تحميل تفاصيل السجل');
    }
  });

  router.post('/records', requireAuth, denyAdmin, async (req, res) => {
    const b = req.body || {};
    for (const k of ['letter_date', 'subject', 'sender_department_id', 'recipient_department_ids', 'urgency']) {
      if (b[k] === undefined) return sendError(res, 422, `الحقل ${k} مطلوب`);
    }
    if (!isIsoDate(b.letter_date)) return sendError(res, 422, 'تاريخ الكتاب غير صحيح');
    if (typeof b.subject !== 'string' || !b.subject.trim() || b.subject.trim().length > 500) {
      return sendError(res, 422, 'الموضوع مطلوب وبحد أقصى 500 حرف');
    }
    if (!Array.isArray(b.recipient_department_ids) || !b.recipient_department_ids.length) {
      return sendError(res, 422, 'اختر جهة مستلمة واحدة على الأقل');
    }
    if (!URGENCIES.includes(b.urgency)) {
      return sendError(res, 422, 'درجة الاستعجال غير صحيحة');
    }

    const sender = parsePositiveInt(b.sender_department_id);
    const senderDept = sender
      ? await q.one('SELECT * FROM departments WHERE id = ? AND is_active = 1', sender)
      : null;
    if (!senderDept) return sendError(res, 422, 'جهة الإرسال غير صحيحة');

    if (req.user.role === 'Unit' && sender !== req.user.department_id) {
      return sendError(res, 403, 'لا يمكن للوحدة التسجيل باسم إدارة أخرى');
    }
    if (req.user.role !== 'Unit' && !senderDept.is_head_office) {
      return sendError(res, 422, 'يسجل مكتب الرئيس المراسلات باسم إحدى جهات المكتب الرئيسي فقط');
    }

    const recipients = [...new Set(b.recipient_department_ids.map(parsePositiveInt))];
    if (recipients.some(x => !x || x === sender)) {
      return sendError(res, 422, 'جهة الاستلام غير صحيحة');
    }
    for (const recId of recipients) {
      const recDept = await q.one('SELECT id FROM departments WHERE id = ? AND is_active = 1', recId);
      if (!recDept) return sendError(res, 422, 'إحدى جهات الاستلام غير موجودة أو غير مفعلة');
    }

    let linkedRecordId = null;
    if (b.linked_record_id !== undefined && b.linked_record_id !== null && b.linked_record_id !== '') {
      linkedRecordId = parsePositiveInt(b.linked_record_id);
      if (!linkedRecordId || !(await canViewRecord(req.user, linkedRecordId))) {
        return sendError(res, 422, 'المعاملة المرتبطة غير موجودة أو غير مصرح بالوصول إليها');
      }
    }

    if (
      b.urgency === 'عادي' &&
      b.due_date_in_letter &&
      (!isIsoDate(b.due_date_in_letter) || b.due_date_in_letter < b.letter_date)
    ) {
      return sendError(res, 422, 'تاريخ الاستحقاق غير صحيح');
    }

    const refNumber =
      typeof b.reference_number === 'string' && b.reference_number.trim()
        ? b.reference_number.trim().slice(0, 120)
        : null;

    try {
      const created = await transaction(async tx => {
        const list = [];
        for (const rec of recipients) {
          const registered = new Date();
          const due = computeDueDate(b.urgency, b.due_date_in_letter, registered);
          const regIso = registered.toISOString();

          const info = await tx.run(
            `INSERT INTO correspondence_records(
              reference_number, letter_date, sender_department_id, recipient_department_id,
              subject, urgency, due_date_in_letter, linked_record_id,
              registered_at, due_at, created_by_user_id, updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
            refNumber,
            b.letter_date,
            sender,
            rec,
            b.subject.trim(),
            b.urgency,
            b.urgency === 'عادي' && b.due_date_in_letter ? b.due_date_in_letter : null,
            linkedRecordId,
            regIso,
            due.toISOString(),
            req.user.id,
            regIso,
          );

          await tx.run(
            `INSERT INTO record_status_history(
              record_id, changed_at, user_id, department_id, new_status, old_version, new_version
            ) VALUES(?,?,?,?,?,?,?)`,
            info.lastInsertRowid,
            regIso,
            req.user.id,
            sender,
            'pending',
            0,
            1,
          );

          const recipientUsers = await tx.all(
            'SELECT id FROM users WHERE department_id = ? AND is_active = 1',
            rec,
          );
          for (const u of recipientUsers) {
            await tx.run(
              'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
              u.id,
              info.lastInsertRowid,
              'creation',
              'مراسلة جديدة',
              `${b.subject.trim()} — من ${senderDept.name}`,
              regIso,
            );
          }

          list.push(
            await tx.one('SELECT * FROM correspondence_records WHERE id = ?', info.lastInsertRowid),
          );
        }
        return list;
      });
      res.status(201).json({ records: created });
    } catch (err) {
      console.error('create record error:', err);
      sendError(res, 500, 'فشل التسجيل وتم التراجع عن العملية بالكامل');
    }
  });

  router.post(
    '/records/:id/attachments',
    express.json({ limit: process.env.VERCEL ? '4.5mb' : '60mb' }),
    requireAuth,
    denyAdmin,
    async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
      if (!(await canViewRecord(req.user, id))) {
        return sendError(res, 404, 'السجل غير موجود');
      }

      const files = req.body?.files;
      if (!Array.isArray(files) || !files.length || files.length > MAX_FILES_PER_UPLOAD) {
        return sendError(res, 422, 'أرفق من صورة واحدة إلى خمس صور');
      }

      const decoded = [];
      for (const f of files) {
        if (!f || typeof f.data !== 'string' || !ALLOWED_IMAGE_MIMES[f.mime]) {
          return sendError(res, 422, 'الصور المسموحة: JPG أو PNG أو WebP');
        }
        const buf = Buffer.from(f.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
        if (!buf.length || buf.length > MAX_FILE_BYTES) {
          return sendError(res, 422, 'حجم كل صورة حتى 10 ميغابايت');
        }
        const detectedMime = detectImageMime(buf);
        if (!detectedMime || !ALLOWED_IMAGE_MIMES[detectedMime]) {
          return sendError(res, 422, 'محتوى الملف لا يطابق صورة صالحة (JPG / PNG / WebP)');
        }
        decoded.push({
          buf,
          mime: detectedMime,
          name: sanitizeFilename(f.name || 'letter'),
        });
      }

      try {
        const storedFiles = [];
        for (const f of decoded) {
          const storedPath = await storage.saveAttachment({
            recordId: id,
            buf: f.buf,
            mime: f.mime,
          });
          storedFiles.push({ ...f, storedPath });
        }

        const saved = await transaction(async tx => {
          const list = [];
          for (const f of storedFiles) {
            const info = await tx.run(
              `INSERT INTO attachments(
                record_id, original_name, stored_path, mime, size, uploaded_by_user_id, created_at
              ) VALUES(?,?,?,?,?,?,?)`,
              id,
              f.name,
              f.storedPath,
              f.mime,
              f.buf.length,
              req.user.id,
              q.now(),
            );
            list.push(
              await tx.one(
                'SELECT id, original_name, mime, size, created_at FROM attachments WHERE id = ?',
                info.lastInsertRowid,
              ),
            );
          }
          return list;
        });
        res.status(201).json({ attachments: saved });
      } catch (err) {
        console.error('attach error:', err);
        sendError(res, 500, 'تعذر حفظ الصورة');
      }
    },
  );

  router.get('/records/:id/attachments/:aid', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const aid = parsePositiveInt(req.params.aid);
    if (!id || !aid) return sendError(res, 422, 'رقم غير صحيح');
    if (!(await canViewRecord(req.user, id))) {
      return sendError(res, 404, 'السجل غير موجود');
    }

    try {
      const att = await q.one(
        'SELECT * FROM attachments WHERE id = ? AND record_id = ?',
        aid,
        id,
      );
      if (!att) return sendError(res, 404, 'المرفق غير موجود');

      const sent = await storage.sendAttachment(res, att.stored_path, {
        mime: att.mime,
        originalName: sanitizeFilename(att.original_name),
      });
      if (!sent) return sendError(res, 404, 'المرفق غير موجود');
    } catch (err) {
      console.error('attachment read error:', err);
      sendError(res, 500, 'تعذر تحميل المرفق');
    }
  });

  router.post('/records/:id/status', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const b = req.body || {};
    if (!id || !STATUSES.includes(b.status)) {
      return sendError(res, 422, 'الحالة غير صحيحة');
    }
    if (!['in_progress', 'reported_done', 'not_done'].includes(b.status)) {
      return sendError(res, 422, 'استخدم مسار التأكيد لهذه الحالة');
    }
    if (!(await canViewRecord(req.user, id))) {
      return sendError(res, 404, 'السجل غير موجود');
    }

    try {
      const r = await q.one('SELECT * FROM correspondence_records WHERE id = ?', id);
      if (req.user.department_id !== r.recipient_department_id) {
        return sendError(res, 403, 'المستلم فقط يستطيع تحديث الحالة');
      }
      if (r.status === 'confirmed_done') {
        return sendError(res, 409, 'تم اعتماد إنجاز هذه المراسلة مسبقاً ولا يمكن تعديل حالتها');
      }
      if (Number(b.version) !== r.version) {
        return sendError(res, 409, 'تغير السجل، أعد تحميل الصفحة');
      }

      const stage = typeof b.stage === 'string' ? b.stage.trim() : '';
      const notDoneReason = typeof b.not_done_reason === 'string' ? b.not_done_reason.trim() : '';
      const replyRef = typeof b.reply_reference === 'string' ? b.reply_reference.trim() : '';

      if (b.status === 'in_progress' && (!stage || stage.length > 1000)) {
        return sendError(res, 422, 'مرحلة الإنجاز مطلوبة');
      }
      if (b.status === 'reported_done' && !isIsoDate(b.reply_date)) {
        return sendError(res, 422, 'تاريخ الرد مطلوب');
      }
      if (b.status === 'not_done' && (!notDoneReason || notDoneReason.length > 1000)) {
        return sendError(res, 422, 'سبب عدم الإنجاز مطلوب');
      }

      const now = q.now();
      await transaction(async tx => {
        await tx.run(
          `UPDATE correspondence_records
           SET status=?, stage=?, not_done_reason=?, reply_date=?, reply_reference=?,
               version=version+1, updated_at=?
           WHERE id=? AND version=?`,
          b.status,
          stage || null,
          notDoneReason || null,
          b.reply_date || null,
          replyRef || null,
          now,
          id,
          r.version,
        );
        await tx.run(
          `INSERT INTO record_status_history(
            record_id, changed_at, user_id, department_id, old_status, new_status,
            new_stage, note, old_version, new_version
          ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          id,
          now,
          req.user.id,
          req.user.department_id,
          r.status,
          b.status,
          stage || null,
          notDoneReason || null,
          r.version,
          r.version + 1,
        );

        if (b.status === 'reported_done' || b.status === 'not_done') {
          const notifyUsers = await tx.all(
            `SELECT id FROM users
             WHERE is_active = 1
               AND (department_id = ? OR role = 'Registrar')`,
            r.sender_department_id,
          );
          const title =
            b.status === 'reported_done' ? 'إبلاغ بإنجاز مراسلة' : 'تعذر إنجاز مراسلة';
          const body =
            b.status === 'reported_done'
              ? `تم الإبلاغ بإنجاز: ${r.subject}`
              : `تعذر إنجاز (${r.subject}): ${notDoneReason}`;
          for (const u of notifyUsers) {
            if (u.id !== req.user.id) {
              await tx.run(
                'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
                u.id,
                id,
                b.status,
                title,
                body,
                now,
              );
            }
          }
        }
      });

      res.json({
        record: enrichRecord(
          await q.one('SELECT * FROM correspondence_records WHERE id = ?', id),
        ),
      });
    } catch (err) {
      console.error('status update error:', err);
      sendError(res, 500, 'تعذر تحديث الحالة');
    }
  });

  async function workflowConfirm(req, res, confirm) {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!confirm && (!note || note.length > 2000)) {
      return sendError(res, 422, 'سبب الرفض مطلوب');
    }

    try {
      const r = await q.one(
        `SELECT r.*
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         WHERE r.id = ? AND s.is_head_office = 1`,
        id,
      );
      if (!r || r.status !== 'reported_done') {
        return sendError(res, 403, 'لا يمكن تنفيذ هذا الإجراء');
      }

      const now = q.now();
      const nextStatus = confirm ? 'confirmed_done' : 'in_progress';
      await transaction(async tx => {
        await tx.run(
          `UPDATE correspondence_records
           SET status=?, confirmed_at=?, version=version+1, updated_at=?
           WHERE id=?`,
          nextStatus,
          confirm ? now : null,
          now,
          id,
        );
        await tx.run(
          `INSERT INTO record_status_history(
            record_id, changed_at, user_id, department_id, old_status, new_status, note, old_version, new_version
          ) VALUES(?,?,?,?,?,?,?,?,?)`,
          id,
          now,
          req.user.id,
          req.user.department_id,
          r.status,
          nextStatus,
          note || null,
          r.version,
          r.version + 1,
        );

        const recipientUsers = await tx.all(
          'SELECT id FROM users WHERE department_id = ? AND is_active = 1',
          r.recipient_department_id,
        );
        const title = confirm ? 'اعتماد إنجاز مراسلة' : 'إعادة مراسلة للاستكمال';
        const body = confirm
          ? `تم اعتماد إنجاز: ${r.subject}`
          : `أُعيدت المراسلة (${r.subject}): ${note}`;
        for (const u of recipientUsers) {
          await tx.run(
            'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
            u.id,
            id,
            confirm ? 'confirmed' : 'rejected',
            title,
            body,
            now,
          );
        }
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('workflow confirm error:', err);
      sendError(res, 500, 'تعذر تنفيذ القرار');
    }
  }

  router.post('/records/:id/confirm', requireAuth, requireRoles('Registrar'), (req, res) =>
    workflowConfirm(req, res, true),
  );

  router.post('/records/:id/reject', requireAuth, requireRoles('Registrar'), (req, res) =>
    workflowConfirm(req, res, false),
  );

  router.post(
    '/records/:id/reminders',
    requireAuth,
    requireRoles('Supervisor', 'Registrar'),
    async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (note.length > 2000) return sendError(res, 422, 'نص التذكير طويل جداً');

      try {
        if (!(await canViewRecord(req.user, id))) {
          return sendError(res, 404, 'السجل غير موجود');
        }
        const r = await q.one('SELECT * FROM correspondence_records WHERE id = ?', id);
        const now = q.now();

        await transaction(async tx => {
          const recipientUsers = await tx.all(
            'SELECT id FROM users WHERE department_id = ? AND is_active = 1',
            r.recipient_department_id,
          );
          await tx.run(
            'INSERT INTO reminders(record_id,sent_by_user_id,recipient_department_id,created_at,note) VALUES(?,?,?,?,?)',
            id,
            req.user.id,
            r.recipient_department_id,
            now,
            note || null,
          );
          for (const u of recipientUsers) {
            await tx.run(
              'INSERT INTO notifications(user_id,record_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)',
              u.id,
              id,
              'reminder',
              'تذكير',
              note || 'يرجى متابعة هذه المراسلة واتخاذ الإجراء اللازم',
              now,
            );
          }
          await tx.run(
            `INSERT INTO record_status_history(
              record_id, changed_at, user_id, department_id, old_status, new_status, note, old_version, new_version
            ) VALUES(?,?,?,?,?,?,?,?,?)`,
            id,
            now,
            req.user.id,
            req.user.department_id,
            r.status,
            r.status,
            note || 'إرسال تذكير',
            r.version,
            r.version,
          );
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('reminder error:', err);
        sendError(res, 500, 'تعذر إرسال التذكير');
      }
    },
  );

  router.get('/records/:id/comments', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
    if (!(await canViewRecord(req.user, id))) {
      return sendError(res, 404, 'السجل غير موجود');
    }

    const comments = await q.all(
      `SELECT c.*, u.display_name, d.name AS department_name
       FROM comments c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN departments d ON d.id = c.department_id
       WHERE c.record_id = ?
       ORDER BY c.id`,
      id,
    );
    res.json(comments);
  });

  router.post('/records/:id/comments', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
    if (!(await canViewRecord(req.user, id))) {
      return sendError(res, 404, 'السجل غير موجود');
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 2000) {
      return sendError(res, 422, 'نص التعليق مطلوب وبحد أقصى 2000 حرف');
    }

    try {
      await q.run(
        'INSERT INTO comments(record_id,user_id,department_id,body,created_at) VALUES(?,?,?,?,?)',
        id,
        req.user.id,
        req.user.department_id,
        body,
        q.now(),
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('comment error:', err);
      sendError(res, 500, 'تعذر حفظ التعليق');
    }
  });

  router.get('/records/:id/audit', requireAuth, denyAdmin, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم السجل غير صحيح');
    if (!(await canViewRecord(req.user, id))) {
      return sendError(res, 404, 'السجل غير موجود');
    }

    const audit = await q.all(
      `SELECT h.*, u.display_name, d.name AS department_name
       FROM record_status_history h
       JOIN users u ON u.id = h.user_id
       LEFT JOIN departments d ON d.id = h.department_id
       WHERE h.record_id = ?
       ORDER BY h.id`,
      id,
    );
    res.json(audit);
  });

  return router;
}
