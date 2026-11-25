import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { SESSION_TTL_MS } from '../constants.js';
import { sendError } from '../utils/validation.js';
import { extractToken } from '../middleware/auth.js';

export function createAuthRouter({ q, transaction, authHelpers, config, loginLimiter }) {
  const router = express.Router();
  const { publicUser, userFromRequest, requireAuth } = authHelpers;

  router.get('/config', (req, res) => {
    res.json({ demo_mode: config.demoMode });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username) return sendError(res, 422, 'اسم المستخدم مطلوب');
    if (!password) return sendError(res, 422, 'كلمة المرور مطلوبة');

    try {
      const user = await q.one('SELECT * FROM users WHERE username = ?', username);
      if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
        return sendError(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }

      const id = crypto.randomBytes(32).toString('hex');
      const now = q.now();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      await transaction(async tx => {
        await tx.run('DELETE FROM sessions WHERE expires_at <= ?', now);
        await tx.run('INSERT INTO sessions VALUES(?,?,?,?,?)', id, user.id, now, expiresAt, now);
      });

      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.cookie('session', id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: SESSION_TTL_MS,
      });
      res.json({ user: await publicUser(user), token: id });
    } catch (err) {
      console.error('login error:', err);
      sendError(res, 500, 'تعذر تنفيذ تسجيل الدخول');
    }
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const token = extractToken(req);
    if (token) await q.run('DELETE FROM sessions WHERE id = ?', token);
    res.clearCookie('session');
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    try {
      const user = await userFromRequest(req);
      if (!user) return res.json({ user: null, demo_mode: config.demoMode });
      res.json({ user: await publicUser(user), demo_mode: config.demoMode });
    } catch (err) {
      console.error('me error:', err);
      sendError(res, 500, 'تعذر التحقق من الجلسة');
    }
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const currentPassword =
      typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword =
      typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!currentPassword) return sendError(res, 422, 'كلمة المرور الحالية مطلوبة');
    if (newPassword.length < 8 || newPassword.length > 128) {
      return sendError(res, 422, 'كلمة المرور الجديدة يجب أن تكون بين 8 و128 حرفاً');
    }
    if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) {
      return sendError(res, 401, 'كلمة المرور الحالية غير صحيحة');
    }

    const currentToken = extractToken(req) || '';

    try {
      await transaction(async tx => {
        await tx.run(
          'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
          bcrypt.hashSync(newPassword, 10),
          q.now(),
          req.user.id,
        );
        await tx.run(
          'DELETE FROM sessions WHERE user_id = ? AND id != ?',
          req.user.id,
          currentToken,
        );
      });
      res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح' });
    } catch (err) {
      console.error('change-password error:', err);
      sendError(res, 500, 'تعذر تحديث كلمة المرور');
    }
  });

  return router;
}
