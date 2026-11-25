import { useEffect, useState } from 'react';
import { api } from '../api';

const statusLabels = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد الإنجاز',
  reported_done: 'بانتظار التأكيد',
  confirmed_done: 'منجز ومؤكد',
  not_done: 'تعذر الإنجاز'
};

export default function DashboardPage({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setError('');
    api('/dashboard')
      .then(setData)
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="panel">
        <div className="alert danger">
          <span>{error}</span>
          <button className="btn btn-secondary" onClick={load}>إعادة المحاولة</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="skeleton">
        <i style={{ height: '120px' }} />
        <i style={{ height: '300px' }} />
      </div>
    );
  }

  const { counts, total, overdue, open_records, summary } = data;

  return (
    <>
      {/* Overdue Warning Banner */}
      {overdue > 0 && (
        <div className="alert danger">
          <div>
            <strong>تنبيه متأخرات:</strong> يوجد <strong>{overdue}</strong> كتاب رسمي متجاوز للموعد المحدد للاستحقاق يتطلب متابعة عاجلة.
          </div>
          <a
            href={user?.role === 'Unit' ? '#records' : '#reports'}
            className="btn btn-danger"
            style={{ padding: '6px 14px', fontSize: '12.5px' }}
          >
            {user?.role === 'Unit' ? 'عرض السجلات المتأخرة' : 'عرض تقرير المتأخرات'}
          </a>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card navy">
          <div className="stat-header">
            <span className="stat-label">إجمالي المراسلات</span>
          </div>
          <div className="stat-value">{total}</div>
        </div>

        <div className="stat-card teal">
          <div className="stat-header">
            <span className="stat-label">قيد المتابعة والإنجاز</span>
          </div>
          <div className="stat-value">{counts.in_progress + counts.pending}</div>
        </div>

        <div className="stat-card green">
          <div className="stat-header">
            <span className="stat-label">منجز ومؤكد</span>
          </div>
          <div className="stat-value">{counts.confirmed_done || 0}</div>
        </div>

        <div className="stat-card red">
          <div className="stat-header">
            <span className="stat-label">متأخر عن الموعد</span>
          </div>
          <div className="stat-value" style={{ color: overdue > 0 ? '#dc2626' : undefined }}>{overdue}</div>
        </div>

        <div className="stat-card orange">
          <div className="stat-header">
            <span className="stat-label">تعذر الإنجاز</span>
          </div>
          <div className="stat-value">{counts.not_done || 0}</div>
        </div>
      </div>

      {/* Approaching Deadlines Panel */}
      <section className="panel">
        <div className="panel-header">
          <h2>الأقرب استحقاقاً والمفتوحة حالياً</h2>
          <a href="#records" className="btn btn-secondary" style={{ fontSize: '13px', padding: '6px 12px' }}>
            عرض كافة السجلات ←
          </a>
        </div>

        {open_records.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم المرجع</th>
                  <th>الموضوع</th>
                  <th>الجهة المستلمة</th>
                  <th>درجة الاستعجال</th>
                  <th>الحالة</th>
                  <th>تاريخ الاستحقاق</th>
                </tr>
              </thead>
              <tbody>
                {open_records.map(r => (
                  <tr key={r.id} onClick={() => location.hash = `records/${r.id}`}>
                    <td>
                      <span className="ref-badge" style={{ fontWeight: 700, color: '#1e3a5f' }}>
                        {r.reference_number || 'بدون رقم'}
                      </span>
                    </td>
                    <td className="subject-cell">
                      <strong>{r.subject}</strong>
                      <span className="text-muted" style={{ fontSize: '12px' }}>من: {r.sender_name}</span>
                    </td>
                    <td>{r.recipient_name}</td>
                    <td>
                      <span className={`urgency ${
                        r.urgency === 'عاجل وعلى الفور' ? 'immediate' :
                        r.urgency === 'عاجل جدا' ? 'very-urgent' :
                        r.urgency === 'عاجل' ? 'urgent' : 'normal'
                      }`}>
                        {r.urgency}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${r.status}`}>
                        {statusLabels[r.status] || r.status}
                      </span>
                    </td>
                    <td>
                      <span className={`deadline-pill ${r.is_overdue ? 'overdue' : ''}`}>
                        {new Date(r.due_at).toLocaleDateString('ar-EG')}
                        {r.is_overdue && ' (متأخر)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted" style={{ padding: '24px 0', textAlign: 'center' }}>
            لا توجد مخاطبات مفتوحة أو متأخرة حالياً. كافة الكتب منجزة.
          </p>
        )}
      </section>

      {/* Department Summary Table (for Supervisors / Registrar) */}
      {summary && summary.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2>مؤشرات الإنجاز بحسب الإدارات</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الإدارة / المعاونية</th>
                  <th>الإجمالي</th>
                  <th>قيد الانتظار</th>
                  <th>قيد الإنجاز</th>
                  <th>بانتظار التأكيد</th>
                  <th>منجز</th>
                  <th>تعذر الإنجاز</th>
                  <th>متأخر</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td><strong>{s.total}</strong></td>
                    <td>{s.pending}</td>
                    <td>{s.in_progress}</td>
                    <td>{s.reported_done || 0}</td>
                    <td style={{ color: '#059669', fontWeight: 600 }}>{s.confirmed_done || 0}</td>
                    <td style={{ color: s.not_done > 0 ? '#dc2626' : undefined, fontWeight: s.not_done > 0 ? 700 : 400 }}>
                      {s.not_done}
                    </td>
                    <td style={{ color: s.overdue > 0 ? '#dc2626' : undefined, fontWeight: s.overdue > 0 ? 700 : 400 }}>
                      {s.overdue || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
