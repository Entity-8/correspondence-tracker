import express from 'express';
import { parsePositiveInt, sendError } from '../utils/validation.js';

export function createNotificationsRouter({ q, authHelpers }) {
  const router = express.Router();
  const { requireAuth } = authHelpers;

  router.get('/', requireAuth, async (req, res) => {
    try {
      const notifications = await q.all(
        `SELECT n.*, r.reference_number, r.subject, r.letter_date, r.due_at
         FROM notifications n
         LEFT JOIN correspondence_records r ON r.id = n.record_id
         WHERE n.user_id = ?
         ORDER BY n.id DESC
         LIMIT 200`,
        req.user.id,
      );
      res.json({ notifications });
    } catch (err) {
      console.error('notifications error:', err);
      sendError(res, 500, 'تعذر تحميل التنبيهات');
    }
  });

  router.get('/unread-count', requireAuth, async (req, res) => {
    try {
      const row = await q.one(
        'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
        req.user.id,
      );
      res.json({ count: row?.count || 0 });
    } catch (err) {
      console.error('unread-count error:', err);
      sendError(res, 500, 'تعذر تحميل عدد التنبيهات');
    }
  });

  router.post('/:id/read', requireAuth, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم التنبيه غير صحيح');
    await q.run(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
      q.now(),
      id,
      req.user.id,
    );
    res.json({ ok: true });
  });

  router.post('/read-all', requireAuth, async (req, res) => {
    await q.run(
      'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
      q.now(),
      req.user.id,
    );
    res.json({ ok: true });
  });

  return router;
}
