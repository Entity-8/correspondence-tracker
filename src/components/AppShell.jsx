import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { setToken } from '../config';
import DashboardPage from './DashboardPage';
import RecordsPage from './RecordsPage';
import NewRecordPage from './NewRecordPage';
import RecordDetailsPage from './RecordDetailsPage';
import ReportsPage from './ReportsPage';
import NotificationsPage from './NotificationsPage';
import AdminPage from './AdminPage';

const Icons = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Records: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  NewRecord: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  Reports: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Notifications: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Admin: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Key: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  Logout: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
};

export default function AppShell({ user, onLogout }) {
  const isAdmin = user.role === 'System admin';
  const defaultRoute = isAdmin ? 'admin' : 'dashboard';
  const [page, setPage] = useState(() => location.hash.slice(1) || defaultRoute);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  // Change password modal state
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwStatus, setPwStatus] = useState({ text: '', isError: false });
  const [pwBusy, setPwBusy] = useState(false);

  const refreshUnreadCount = useCallback(() => {
    if (isAdmin) return;
    api('/notifications/unread-count')
      .then(x => setCount(x.count || 0))
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    const syncRoute = () => setPage(location.hash.slice(1) || defaultRoute);
    window.addEventListener('hashchange', syncRoute);
    if (!location.hash) {
      location.hash = defaultRoute;
    }
    refreshUnreadCount();
    const timer = setInterval(refreshUnreadCount, 30000);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      clearInterval(timer);
    };
  }, [defaultRoute, refreshUnreadCount]);

  useEffect(() => {
    document.body.classList.toggle('no-scroll', open);
    return () => document.body.classList.remove('no-scroll');
  }, [open]);

  function go(p) {
    location.hash = p;
    setOpen(false);
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout; clear client state anyway
    } finally {
      setToken('');
      onLogout();
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwStatus({ text: '', isError: false });
    if (!pwForm.current_password) return setPwStatus({ text: 'كلمة المرور الحالية مطلوبة', isError: true });
    if (pwForm.new_password.length < 8) return setPwStatus({ text: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل', isError: true });
    if (pwForm.new_password !== pwForm.confirm_password) {
      return setPwStatus({ text: 'تأكيد كلمة المرور غير مطابق', isError: true });
    }

    setPwBusy(true);
    try {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: {
          current_password: pwForm.current_password,
          new_password: pwForm.new_password,
        },
      });
      setPwStatus({ text: res.message || 'تم تحديث كلمة المرور بنجاح', isError: false });
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => {
        setPwModalOpen(false);
        setPwStatus({ text: '', isError: false });
      }, 1500);
    } catch (err) {
      setPwStatus({ text: err.message, isError: true });
    } finally {
      setPwBusy(false);
    }
  }

  const [path, id] = page.split('/');

  const navItems = isAdmin
    ? [{ key: 'admin', label: 'إدارة المستخدمين والإدارات', icon: Icons.Admin }]
    : [
        { key: 'dashboard', label: 'لوحة المتابعة', icon: Icons.Dashboard },
        { key: 'records', label: 'السجلات والمراسلات', icon: Icons.Records },
        { key: 'records/new', label: 'تسجيل كتاب جديد', icon: Icons.NewRecord },
        ...(user.role !== 'Unit' ? [{ key: 'reports', label: 'التقارير والإحصائيات', icon: Icons.Reports }] : []),
        { key: 'notifications', label: 'التنبيهات', icon: Icons.Notifications, hasCount: true },
      ];

  let content = null;
  if (isAdmin) {
    content = <AdminPage />;
  } else if (path === 'records' && id === 'new') {
    content = <NewRecordPage user={user} />;
  } else if (path === 'records' && id) {
    content = <RecordDetailsPage id={id} user={user} />;
  } else if (path === 'records') {
    content = <RecordsPage />;
  } else if (path === 'reports' && user.role !== 'Unit') {
    content = <ReportsPage />;
  } else if (path === 'notifications') {
    content = <NotificationsPage onUnreadChange={refreshUnreadCount} />;
  } else {
    content = <DashboardPage user={user} />;
  }

  const pageTitle = isAdmin
    ? 'إدارة الحسابات والصلاحيات'
    : path === 'dashboard'
    ? 'لوحة المؤشرات والمتابعة'
    : path === 'records' && id === 'new'
    ? 'تسجيل كتاب رسمي جديد'
    : path === 'records' && id
    ? 'تفاصيل ومتابعة المراسلة'
    : path === 'records'
    ? 'سجل المراسلات الرسمية'
    : path === 'reports'
    ? 'تقارير الأداء والمتأخرات'
    : path === 'notifications'
    ? 'مركز التنبيهات'
    : 'لوحة المتابعة';

  return (
    <div className="app-shell">
      <aside className={`drawer ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-icon-box">م</div>
          <div className="brand-text">
            <h1>المكتب السياسي</h1>
            <span>منظومة متابعة المراسلات</span>
          </div>
        </div>

        <nav>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive =
              page === item.key ||
              (item.key === 'records' && path === 'records' && id !== 'new');
            return (
              <button
                key={item.key}
                className={isActive ? 'active' : ''}
                onClick={() => go(item.key)}
              >
                <Icon />
                <span>{item.label}</span>
                {item.hasCount && count > 0 && <span className="count-badge">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="identity-card">
          <div className="name">{user.display_name}</div>
          <div className="role-pill">
            {user.department_name || 'مدير النظام'} · {user.role}
          </div>
        </div>

        <div className="drawer-footer">
          <button
            type="button"
            className="logout-btn"
            style={{ marginBottom: '8px', borderColor: '#334155', color: '#cbd5e1' }}
            onClick={() => {
              setPwModalOpen(true);
              setOpen(false);
            }}
          >
            <Icons.Key />
            <span>تغيير كلمة المرور</span>
          </button>
          <button type="button" className="logout-btn" onClick={logout}>
            <Icons.Logout />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-toggle" onClick={() => setOpen(!open)} aria-label="فتح القائمة">
              ☰
            </button>
            <div className="page-titles">
              <span className="eyebrow">جمهورية العراق · المكتب السياسي</span>
              <h2>{pageTitle}</h2>
            </div>
          </div>

          <div className="topbar-right">
            <div className="header-user-tag">
              <div className="avatar-circle">{user.display_name?.[0] || 'م'}</div>
              <span>{user.display_name}</span>
            </div>
          </div>
        </header>

        <main className="content">{content}</main>
      </div>

      {open && <button className="overlay" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" />}

      {pwModalOpen && (
        <div className="modal-backdrop" onClick={() => setPwModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>تغيير كلمة المرور</strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPwModalOpen(false)}
              >
                إغلاق ✕
              </button>
            </div>
            <form onSubmit={handleChangePassword} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {pwStatus.text && (
                <div className={`alert ${pwStatus.isError ? 'danger' : 'success'}`}>
                  <span>{pwStatus.text}</span>
                </div>
              )}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  كلمة المرور الحالية
                </label>
                <input
                  type="password"
                  value={pwForm.current_password}
                  onChange={e => setPwForm({ ...pwForm, current_password: e.target.value })}
                  autoComplete="current-password"
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  كلمة المرور الجديدة (8 أحرف على الأقل)
                </label>
                <input
                  type="password"
                  value={pwForm.new_password}
                  onChange={e => setPwForm({ ...pwForm, new_password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  تأكيد كلمة المرور الجديدة
                </label>
                <input
                  type="password"
                  value={pwForm.confirm_password}
                  onChange={e => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPwModalOpen(false)}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={pwBusy}>
                  {pwBusy ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
