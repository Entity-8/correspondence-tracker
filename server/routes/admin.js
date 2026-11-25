import express from 'express';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants.js';
import { parsePositiveInt, sendError } from '../utils/validation.js';

export function createAdminRouter({ q, transaction, authHelpers }) {
  const router = express.Router();
  const { requireAuth, requireRoles } = authHelpers;
  const adminOnly = [requireAuth, requireRoles('System admin')];

  router.get('/users', ...adminOnly, async (req, res) => {
    const users = await q.all(
      `SELECT u.id, u.username, u.display_name, u.department_id,
              d.name AS department_name, u.role, u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ORDER BY u.id`,
    );
    res.json({ users });
  });

  router.post('/users', ...adminOnly, async (req, res) => {
    const b = req.body || {};
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    if (!/^[\w\u0600-\u06ff-]{3,80}$/.test(username)) {
      return sendError(res, 422, 'اسم المستخدم غير صحيح (3 إلى 80 حرفاً)');
    }
    if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) {
      return sendError(res, 422, 'كلمة المرور يجب أن تكون بين 8 و128 حرفاً');
    }
    const displayName = typeof b.display_name === 'string' ? b.display_name.trim() : '';
    if (!displayName || displayName.length > 150) {
      return sendError(res, 422, 'الاسم الظاهر مطلوب وبحد أقصى 150 حرفاً');
    }
    if (!ROLES.includes(b.role)) return sendError(res, 422, 'الدور غير مسموح');

    let deptId = null;
    if (b.role !== 'System admin') {
      deptId = parsePositiveInt(b.department_id);
      const dept = deptId
        ? await q.one('SELECT * FROM departments WHERE id = ? AND is_active = 1', deptId)
        : null;
      if (!dept || dept.role !== b.role) {
        return sendError(res, 422, 'الدور لا يتوافق مع الإدارة المختارة');
      }
    }

    try {
      const now = q.now();
      const info = await q.run(
        `INSERT INTO users(username,password_hash,display_name,department_id,role,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?)`,
        username,
        bcrypt.hashSync(b.password, 10),
        displayName,
        deptId,
        b.role,
        now,
        now,
      );
      const created = await q.one(
        `SELECT u.id, u.username, u.display_name, u.department_id,
                d.name AS department_name, u.role, u.is_active, u.created_at
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = ?`,
        info.lastInsertRowid,
      );
      res.status(201).json(created);
    } catch {
      sendError(res, 422, 'اسم المستخدم مستخدم مسبقاً');
    }
  });

  router.put('/users/:id', ...adminOnly, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم المستخدم غير صحيح');

    const current = await q.one('SELECT * FROM users WHERE id = ?', id);
    if (!current) return sendError(res, 404, 'المستخدم غير موجود');

    const b = req.body || {};
    const displayName =
      b.display_name === undefined
        ? current.display_name
        : typeof b.display_name === 'string'
        ? b.display_name.trim()
        : '';
    const role = b.role === undefined ? current.role : b.role;
    const active = b.is_active === undefined ? current.is_active : b.is_active ? 1 : 0;

    if (!displayName || displayName.length > 150) {
      return sendError(res, 422, 'الاسم الظاهر مطلوب وبحد أقصى 150 حرفاً');
    }
    if (!ROLES.includes(role)) return sendError(res, 422, 'الدور غير مسموح');
    if (id === req.user.id && !active) {
      return sendError(res, 422, 'لا يمكنك تعطيل حسابك الحالي');
    }
    if (id === req.user.id && role !== 'System admin') {
      return sendError(res, 422, 'لا يمكنك خفض صلاحية حسابك الحالي من مدير نظام');
    }

    let departmentId = null;
    if (role !== 'System admin') {
      departmentId =
        b.department_id === undefined ? current.department_id : parsePositiveInt(b.department_id);
      const department = departmentId
        ? await q.one('SELECT * FROM departments WHERE id = ? AND is_active = 1', departmentId)
        : null;
      if (!department || department.role !== role) {
        return sendError(res, 422, 'الدور لا يتوافق مع الإدارة المختارة');
      }
    }

    try {
      await transaction(async tx => {
        await tx.run(
          'UPDATE users SET display_name=?, department_id=?, role=?, is_active=?, updated_at=? WHERE id=?',
          displayName,
          departmentId,
          role,
          active,
          q.now(),
          id,
        );
        if (!active) await tx.run('DELETE FROM sessions WHERE user_id = ?', id);
      });
      const updated = await q.one(
        `SELECT u.id, u.username, u.display_name, u.department_id,
                d.name AS department_name, u.role, u.is_active, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = ?`,
        id,
      );
      res.json({ user: updated });
    } catch (err) {
      console.error('update user error:', err);
      sendError(res, 500, 'تعذر تعديل المستخدم');
    }
  });

  router.post('/users/:id/reset-password', ...adminOnly, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const password = req.body?.password;
    if (!id) return sendError(res, 422, 'رقم المستخدم غير صحيح');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return sendError(res, 422, 'كلمة المرور يجب أن تكون بين 8 و128 حرفاً');
    }
    if (!(await q.one('SELECT id FROM users WHERE id = ?', id))) {
      return sendError(res, 404, 'المستخدم غير موجود');
    }

    try {
      await transaction(async tx => {
        await tx.run(
          'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
          bcrypt.hashSync(password, 10),
          q.now(),
          id,
        );
        await tx.run('DELETE FROM sessions WHERE user_id = ?', id);
      });
      res.json({ ok: true, message: 'تم إعادة تعيين كلمة المرور وإبطال الجلسات السابقة' });
    } catch (err) {
      console.error('reset password error:', err);
      sendError(res, 500, 'تعذر إعادة تعيين كلمة المرور');
    }
  });

  router.post('/users/:id/deactivate', ...adminOnly, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم المستخدم غير صحيح');
    if (id === req.user.id) return sendError(res, 422, 'لا يمكنك تعطيل حسابك الحالي');
    await transaction(async tx => {
      await tx.run('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', q.now(), id);
      await tx.run('DELETE FROM sessions WHERE user_id = ?', id);
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/reactivate', ...adminOnly, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم المستخدم غير صحيح');
    await q.run('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?', q.now(), id);
    res.json({ ok: true });
  });

  router.get('/departments', ...adminOnly, async (req, res) => {
    res.json({ departments: await q.all('SELECT * FROM departments ORDER BY id') });
  });

  router.put('/departments/:id', ...adminOnly, async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendError(res, 422, 'رقم الإدارة غير صحيح');

    const department = await q.one('SELECT * FROM departments WHERE id = ?', id);
    if (!department) return sendError(res, 404, 'الإدارة غير موجودة');

    const name =
      req.body?.name === undefined
        ? department.name
        : typeof req.body.name === 'string'
        ? req.body.name.trim()
        : '';
    if (!name || name.length > 200) {
      return sendError(res, 422, 'اسم الإدارة مطلوب وبحد أقصى 200 حرف');
    }
    const isActive =
      req.body?.is_active === undefined ? department.is_active : req.body.is_active ? 1 : 0;

    try {
      await q.run('UPDATE departments SET name = ?, is_active = ? WHERE id = ?', name, isActive, id);
      res.json({ department: await q.one('SELECT * FROM departments WHERE id = ?', id) });
    } catch {
      sendError(res, 422, 'اسم الإدارة مستخدم مسبقاً أو غير صالح');
    }
  });

  return router;
}
