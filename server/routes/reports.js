import express from 'express';
import { STATUS_LABELS_AR } from '../constants.js';
import { buildExcelBuffer } from '../utils/excel.js';
import { isIsoDate, sendError } from '../utils/validation.js';
import { enrichRecord } from './records.js';

export function createReportsRouter({ q, authHelpers }) {
  const router = express.Router();
  const { requireAuth, requireRoles } = authHelpers;
  const allowReportRoles = requireRoles('Supervisor', 'Registrar');

  async function getReportRows(type) {
    if (type === 'late') {
      const nowMs = Date.now();
      const rows = await q.all(
        `SELECT r.*, s.name AS sender_name, t.name AS recipient_name
         FROM correspondence_records r
         JOIN departments s ON s.id = r.sender_department_id
         JOIN departments t ON t.id = r.recipient_department_id
         WHERE (r.status != 'confirmed_done' AND r.due_at < ?)
            OR (r.status = 'confirmed_done' AND r.confirmed_at > r.due_at)
         ORDER BY t.id, r.due_at`,
        q.now(),
      );
      return rows.map(r => {
        const comparison =
          r.status === 'confirmed_done' ? new Date(r.confirmed_at).getTime() : nowMs;
        const daysLate = Math.max(
          0,
          Math.ceil((comparison - new Date(r.due_at).getTime()) / 86400000),
        );
        return { ...enrichRecord(r), days_late: daysLate };
      });
    }

    const rows = await q.all(
      `SELECT r.*, s.name AS sender_name, t.name AS recipient_name
       FROM correspondence_records r
       JOIN departments s ON s.id = r.sender_department_id
       JOIN departments t ON t.id = r.recipient_department_id
       WHERE r.status = 'not_done'
       ORDER BY t.id, r.due_at`,
    );
    return rows.map(enrichRecord);
  }

  function groupRowsByDepartment(rows) {
    const groups = {};
    for (const row of rows) {
      const key = String(row.recipient_department_id);
      if (!groups[key]) {
        groups[key] = {
          department_id: row.recipient_department_id,
          department_name: row.recipient_name,
          rows: [],
        };
      }
      groups[key].rows.push(row);
    }
    return Object.values(groups);
  }

  async function getSummaryRows(from, to) {
    const rows = await q.all(
      `SELECT d.id, d.name,
        SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN r.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN r.status = 'reported_done' THEN 1 ELSE 0 END) AS reported_done,
        SUM(CASE WHEN r.status = 'confirmed_done' THEN 1 ELSE 0 END) AS confirmed_done,
        SUM(CASE WHEN r.status = 'not_done' THEN 1 ELSE 0 END) AS not_done,
        COUNT(r.id) AS total,
        SUM(CASE WHEN r.due_at < ? AND r.status != 'confirmed_done' THEN 1 ELSE 0 END) AS overdue
       FROM departments d
       LEFT JOIN correspondence_records r
         ON d.id = r.recipient_department_id
        AND r.registered_at >= ?
        AND r.registered_at <= ?
       GROUP BY d.id
       ORDER BY d.id`,
      q.now(),
      `${from}T00:00:00.000Z`,
      `${to}T23:59:59.999Z`,
    );
    return rows.map(row =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? 0])),
    );
  }

  function validateRange(req, res) {
    const { from, to } = req.query;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      sendError(res, 422, 'نطاق التاريخ غير صحيح');
      return null;
    }
    return { from, to };
  }

  router.get('/late', requireAuth, allowReportRoles, async (req, res) => {
    try {
      const rows = await getReportRows('late');
      res.json({ rows, groups: groupRowsByDepartment(rows) });
    } catch (err) {
      console.error('late report error:', err);
      sendError(res, 500, 'تعذر إنشاء تقرير المتأخرات');
    }
  });

  router.get('/not-done', requireAuth, allowReportRoles, async (req, res) => {
    try {
      const rows = await getReportRows('not-done');
      res.json({ rows, groups: groupRowsByDepartment(rows) });
    } catch (err) {
      console.error('not-done report error:', err);
      sendError(res, 500, 'تعذر إنشاء تقرير غير المنجز');
    }
  });

  router.get('/department-summary', requireAuth, allowReportRoles, async (req, res) => {
    const range = validateRange(req, res);
    if (!range) return;
    try {
      res.json({
        rows: await getSummaryRows(range.from, range.to),
        from: range.from,
        to: range.to,
      });
    } catch (err) {
      console.error('summary report error:', err);
      sendError(res, 500, 'تعذر إنشاء ملخص الإدارات');
    }
  });

  router.get('/:type/export', requireAuth, allowReportRoles, async (req, res) => {
    const { type } = req.params;
    if (!['late', 'not-done', 'department-summary'].includes(type)) {
      return sendError(res, 422, 'نوع التقرير غير صحيح');
    }

    try {
      let headings;
      let rows;
      let sheetTitle;

      if (type === 'department-summary') {
        const range = validateRange(req, res);
        if (!range) return;
        sheetTitle = 'ملخص الإدارات';
        headings = [
          'الإدارة',
          'الإجمالي',
          'قيد الانتظار',
          'قيد الإنجاز',
          'بانتظار التأكيد',
          'منجز ومؤكد',
          'تعذر الإنجاز',
          'متأخر',
        ];
        rows = (await getSummaryRows(range.from, range.to)).map(r => [
          r.name,
          r.total,
          r.pending,
          r.in_progress,
          r.reported_done,
          r.confirmed_done,
          r.not_done,
          r.overdue,
        ]);
      } else {
        sheetTitle = type === 'late' ? 'المراسلات المتأخرة' : 'تعذر الإنجاز';
        headings = [
          'رقم المرجع',
          'تاريخ الكتاب',
          'الموضوع',
          'الجهة المرسلة',
          'الجهة المستلمة',
          'الحالة',
          'تاريخ الاستحقاق',
          'أيام التأخير',
          'سبب عدم الإنجاز',
        ];
        rows = (await getReportRows(type)).map(r => [
          r.reference_number || '—',
          r.letter_date,
          r.subject,
          r.sender_name,
          r.recipient_name,
          STATUS_LABELS_AR[r.status] || r.status,
          r.due_at?.slice(0, 10) || '',
          r.days_late ?? '',
          r.not_done_reason || '',
        ]);
      }

      const buffer = await buildExcelBuffer({ sheetTitle, headings, rows });
      await q.run(
        'INSERT INTO report_exports(requested_by_user_id,report_type,filters_json,created_at) VALUES(?,?,?,?)',
        req.user.id,
        type,
        JSON.stringify(req.query),
        q.now(),
      );

      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report-${type}.xlsx"`,
      });
      res.send(buffer);
    } catch (err) {
      console.error('export error:', err);
      sendError(res, 500, 'تعذر تصدير التقرير');
    }
  });

  return router;
}
