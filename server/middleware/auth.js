import { sendError } from '../utils/validation.js';

const TOKEN_RE = /^[a-f0-9]{64}$/i;

export function extractToken(req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  if (bearer) return bearer;

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === 'session') {
      const val = rest.join('=').trim();
      return TOKEN_RE.test(val) ? val : null;
    }
  }
  return null;
}

export function createAuthHelpers(q) {
  async function publicUser(u) {
    const departmentName =
      u.department_name ||
      (u.department_id
        ? (await q.one('SELECT name FROM departments WHERE id=?', u.department_id))?.name
        : null) ||
      null;
    return {
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      department_id: u.department_id,
      department_name: departmentName,
      role: u.role,
    };
  }

  async function userFromRequest(req) {
    const token = extractToken(req);
    if (!token) return null;
    const session = await q.one(
      'SELECT * FROM sessions WHERE id=? AND expires_at>?',
      token,
      q.now(),
    );
    if (!session) return null;
    const user = await q.one(
      `SELECT u.*, d.name AS department_name, d.is_head_office
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? AND u.is_active = 1`,
      session.user_id,
    );
    if (!user) return null;
    await q.run('UPDATE sessions SET last_seen_at=? WHERE id=?', q.now(), token);
    return user;
  }

  async function requireAuth(req, res, next) {
    try {
      const user = await userFromRequest(req);
      if (!user) return sendError(res, 401, 'انتهت الجلسة، يرجى تسجيل الدخول');
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireRoles(...roles) {
    return (req, res, next) =>
      roles.includes(req.user.role)
        ? next()
        : sendError(res, 403, 'لا تملك صلاحية الوصول إلى هذا القسم');
  }

  const denyAdmin = requireRoles('Supervisor', 'Registrar', 'Unit');

  async function canViewRecord(user, recordId) {
    if (!user || user.role === 'System admin') return false;
    if (user.role === 'Supervisor') {
      return Boolean(await q.one('SELECT id FROM correspondence_records WHERE id=?', recordId));
    }
    if (user.role === 'Registrar') {
      return Boolean(
        await q.one(
          `SELECT r.id
           FROM correspondence_records r
           JOIN departments s ON s.id = r.sender_department_id
           WHERE r.id = ? AND (s.is_head_office = 1 OR r.recipient_department_id = ?)`,
          recordId,
          user.department_id,
        ),
      );
    }
    return Boolean(
      await q.one(
        `SELECT id FROM correspondence_records
         WHERE id = ? AND (sender_department_id = ? OR recipient_department_id = ?)`,
        recordId,
        user.department_id,
        user.department_id,
      ),
    );
  }

  return {
    publicUser,
    userFromRequest,
    requireAuth,
    requireRoles,
    denyAdmin,
    canViewRecord,
  };
}
