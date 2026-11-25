import { useEffect, useState } from 'react';
import { api } from '../api';

export default function NotificationsPage({ onUnreadChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setError('');
    api('/notifications')
      .then(setData)
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleMarkAsRead(id) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      load();
      onUnreadChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMarkAllAsRead() {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      load();
      onUnreadChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !data) {
    return (
      <div className="panel alert danger">
        <span>{error}</span>
        <button className="btn btn-secondary" onClick={load}>إعادة المحاولة</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="skeleton">
        <i style={{ height: '60px' }} />
        <i style={{ height: '180px' }} />
      </div>
    );
  }

  const notifications = data.notifications || [];
  const unreadCount = notifications.filter(n => !n.read_at).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>مركز التنبيهات والإشعارات الرسمية</h2>
          {unreadCount > 0 && (
            <span style={{ fontSize: '12.5px', color: '#2563eb', fontWeight: 600 }}>
              يوجد {unreadCount} إشعار غير مقروء
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button type="button" className="btn btn-secondary" onClick={handleMarkAllAsRead}>
            ✓ تحديد كافة التنبيهات كمقروءة
          </button>
        )}
      </div>

      {error && (
        <div className="alert danger" style={{ marginBottom: '12px' }}>
          <span>{error}</span>
        </div>
      )}

      {notifications.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {notifications.map(n => {
            const isUnread = !n.read_at;
            return (
              <div
                key={n.id}
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  background: isUnread ? '#eff6ff' : '#f8fafc',
                  border: `1px solid ${isUnread ? '#bfdbfe' : '#e2e8f0'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '16px',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: isUnread ? '#2563eb' : 'transparent',
                      marginTop: '6px',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <strong style={{ fontSize: '14.5px', color: '#0f172a', display: 'block', marginBottom: '3px' }}>
                      {n.title}
                    </strong>
                    <p style={{ fontSize: '13.5px', color: '#334155', marginBottom: '4px' }}>
                      {n.body}
                    </p>
                    <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                      {new Date(n.created_at).toLocaleString('ar-EG')}
                      {n.reference_number && ` · رقم المرجع: ${n.reference_number}`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {isUnread && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => handleMarkAsRead(n.id)}
                    >
                      تمت القراءة
                    </button>
                  )}
                  {n.record_id && (
                    <a
                      href={`#records/${n.record_id}`}
                      className="btn btn-primary"
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      فتح المعاملة ←
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔔</div>
          <p style={{ fontSize: '14px' }}>لا توجد تنبيهات جديدة في حسابك حالياً.</p>
        </div>
      )}
    </section>
  );
}
