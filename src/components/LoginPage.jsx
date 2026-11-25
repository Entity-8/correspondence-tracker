import { useState } from 'react';
import { api } from '../api';

const DEMO_ACCOUNTS = [
  { label: 'رئيس المكتب السياسي', user: 'head', pass: 'Head123!' },
  { label: 'أمانة السر', user: 'registrar', pass: 'Registrar123!' },
  { label: 'مدير المكتب', user: 'director', pass: 'Director123!' },
  { label: 'جهة تنفيذية (وحدة 06)', user: 'unit06', pass: 'Unit123!' },
  { label: 'مدير النظام', user: 'admin', pass: 'Admin123!' },
];

export default function LoginPage({ demoMode, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    if (e) e.preventDefault();
    setError('');

    if (!form.username.trim()) return setError('اسم المستخدم مطلوب');
    if (!form.password) return setError('كلمة المرور مطلوبة');

    setBusy(true);
    try {
      const res = await api('/auth/login', { method: 'POST', body: form });
      onLogin(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleDemoClick(account) {
    setForm({ username: account.user, password: account.pass });
    setError('');
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="seal">م</div>
        <span
          style={{
            fontSize: '11.5px',
            color: '#2563eb',
            fontWeight: 700,
            letterSpacing: '0.5px',
            marginBottom: '4px',
          }}
        >
          جمهورية العراق · المكتب السياسي
        </span>
        <h1>منظومة متابعة المراسلات</h1>
        <p className="muted">
          تسجيل، توجيه، وتتبع إنجاز الكتب الرسمية والتوجيهات الداخلية
        </p>

        <form onSubmit={submit}>
          <div>
            <label htmlFor="username">اسم المستخدم</label>
            <input
              id="username"
              type="text"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              autoComplete="username"
              placeholder="مثال: head أو registrar"
            />
          </div>

          <div>
            <label htmlFor="password">كلمة المرور</label>
            <div className="password-box">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>

          {error && <div className="alert danger">{error}</div>}

          <button type="submit" className="btn btn-primary submit-btn" disabled={busy}>
            {busy ? 'جاري التحقق من الجلسة...' : 'تسجيل الدخول إلى المنظومة'}
          </button>
        </form>

        {demoMode && (
          <div className="demo-pills">
            <span style={{ width: '100%', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
              حسابات تجريبية سريعة (وضع العرض التجريبي):
            </span>
            {DEMO_ACCOUNTS.map(acc => (
              <button
                key={acc.user}
                type="button"
                className="demo-pill"
                onClick={() => handleDemoClick(acc)}
              >
                {acc.label}
              </button>
            ))}
          </div>
        )}

        <small style={{ marginTop: '20px', fontSize: '11px', color: '#94a3b8' }}>
          للاستخدام الرسمي والداخلي فقط • كافة العمليات مسجلة في سجل الرقابة
        </small>
      </section>
    </main>
  );
}
