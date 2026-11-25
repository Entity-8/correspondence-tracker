import { Component, useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './components/LoginPage';
import AppShell from './components/AppShell';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'حدث خطأ غير متوقع في الواجهة' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page">
          <div className="login-card">
            <div className="seal">!</div>
            <h1>تعذر عرض الصفحة</h1>
            <p className="muted">{this.state.message}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                location.hash = '';
                location.reload();
              }}
            >
              إعادة تحميل المنظومة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let live = true;
    api('/auth/me')
      .then(res => {
        if (!live) return;
        setUser(res.user || null);
        setDemoMode(Boolean(res.demo_mode));
      })
      .catch(() => {})
      .finally(() => live && setChecking(false));

    const handleExpired = () => setUser(null);
    window.addEventListener('auth:expired', handleExpired);
    return () => {
      live = false;
      window.removeEventListener('auth:expired', handleExpired);
    };
  }, []);

  if (checking) {
    return <div className="loading-screen">جاري التحقق من الجلسة…</div>;
  }

  return (
    <ErrorBoundary>
      {user ? (
        <AppShell user={user} onLogout={() => setUser(null)} />
      ) : (
        <LoginPage demoMode={demoMode} onLogin={setUser} />
      )}
    </ErrorBoundary>
  );
}
