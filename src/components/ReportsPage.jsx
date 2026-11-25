import React, { useEffect, useState } from 'react';
import { api, apiBlob } from '../api';

const statusLabels = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد الإنجاز',
  reported_done: 'بانتظار التأكيد',
  confirmed_done: 'منجز ومؤكد',
  not_done: 'تعذر الإنجاز',
};

const formatDate = v => (v ? new Date(v).toLocaleDateString('ar-EG') : '—');

export default function ReportsPage() {
  const [reportType, setReportType] = useState('late');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState('2025-01-01');
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  function load() {
    setError('');
    setData(null);
    const query = reportType === 'department-summary' ? `?from=${dateFrom}&to=${dateTo}` : '';
    api(`/reports/${reportType}${query}`)
      .then(setData)
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    load();
  }, [reportType]);

  async function exportReport() {
    setError('');
    setExporting(true);
    try {
      const query = reportType === 'department-summary' ? `?from=${dateFrom}&to=${dateTo}` : '';
      const blob = await apiBlob(`/reports/${reportType}/export${query}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  const tabs = [
    { key: 'late', label: 'المراسلات المتأخرة' },
    { key: 'not-done', label: 'تعذر الإنجاز' },
    { key: 'department-summary', label: 'ملخص أداء الإدارات' },
  ];

  const summaryTotals =
    reportType === 'department-summary' && data?.rows
      ? data.rows.reduce(
          (acc, r) => ({
            total: acc.total + r.total,
            pending: acc.pending + r.pending,
            in_progress: acc.in_progress + r.in_progress,
            reported_done: acc.reported_done + r.reported_done,
            confirmed_done: acc.confirmed_done + r.confirmed_done,
            not_done: acc.not_done + r.not_done,
            overdue: acc.overdue + r.overdue,
          }),
          { total: 0, pending: 0, in_progress: 0, reported_done: 0, confirmed_done: 0, not_done: 0, overdue: 0 },
        )
      : null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', background: '#e2e8f0', padding: '4px', borderRadius: '8px', flexWrap: 'wrap' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={reportType === tab.key ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ padding: '8px 16px', fontSize: '13.5px' }}
              onClick={() => setReportType(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            🖨️ طباعة التقرير
          </button>
          <button type="button" className="btn btn-primary" disabled={exporting} onClick={exportReport}>
            {exporting ? 'جاري التصدير...' : '📊 تصدير Excel'}
          </button>
        </div>
      </div>

      {reportType === 'department-summary' && (
        <section className="panel" style={{ padding: '16px 20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '13.5px' }}>تحديد النطاق الزمني:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12.5px', color: '#64748b' }}>من:</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12.5px', color: '#64748b' }}>إلى:</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <button type="button" className="btn btn-primary" style={{ padding: '6px 14px' }} onClick={load}>
              تطبيق التصفية
            </button>
          </div>
        </section>
      )}

      {error && <div className="alert danger">{error}</div>}

      {!data ? (
        <div className="skeleton">
          <i style={{ height: '60px' }} />
          <i style={{ height: '300px' }} />
        </div>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h2>
              {reportType === 'late'
                ? 'تقرير المراسلات المتأخرة عن موعد الاستحقاق'
                : reportType === 'not-done'
                ? 'تقرير المراسلات التي تعذر إنجازها'
                : 'الملخص الإحصائي الشامل لأداء الإدارات'}
            </h2>
          </div>

          {data.rows?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {reportType === 'department-summary' ? (
                      <>
                        <th>الإدارة / المعاونية</th>
                        <th>الإجمالي</th>
                        <th>قيد الانتظار</th>
                        <th>قيد الإنجاز</th>
                        <th>بانتظار التأكيد</th>
                        <th>منجز</th>
                        <th>لم ينجز</th>
                        <th>متأخر</th>
                      </>
                    ) : (
                      <>
                        <th>المرجع</th>
                        <th>الموضوع</th>
                        <th>الجهة المستلمة</th>
                        <th>الحالة</th>
                        <th>الاستحقاق</th>
                        {reportType === 'late' && <th>أيام التأخير</th>}
                        {reportType === 'not-done' && <th>سبب تعذر الإنجاز</th>}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {reportType === 'department-summary'
                    ? data.rows.map(r => (
                        <tr key={r.id || r.name}>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td><strong>{r.total}</strong></td>
                          <td>{r.pending}</td>
                          <td>{r.in_progress}</td>
                          <td>{r.reported_done}</td>
                          <td style={{ color: '#059669', fontWeight: 600 }}>{r.confirmed_done}</td>
                          <td style={{ color: r.not_done > 0 ? '#dc2626' : undefined, fontWeight: r.not_done > 0 ? 700 : 400 }}>
                            {r.not_done}
                          </td>
                          <td style={{ color: r.overdue > 0 ? '#dc2626' : undefined, fontWeight: r.overdue > 0 ? 700 : 400 }}>
                            {r.overdue}
                          </td>
                        </tr>
                      ))
                    : (data.groups || []).map(group => (
                        <React.Fragment key={group.department_id}>
                          <tr style={{ background: '#f1f5f9' }}>
                            <td colSpan={6} style={{ fontWeight: 700, color: '#1e3a5f' }}>
                              الإدارة المستلمة: {group.department_name} ({group.rows.length} معاملة)
                            </td>
                          </tr>
                          {group.rows.map(r => (
                            <tr key={r.id} onClick={() => (location.hash = `records/${r.id}`)}>
                              <td style={{ fontWeight: 600, color: '#2563eb' }}>{r.reference_number || '—'}</td>
                              <td style={{ fontWeight: 600 }}>{r.subject}</td>
                              <td>{r.recipient_name}</td>
                              <td>
                                <span className={`status-badge ${r.status}`}>
                                  {statusLabels[r.status] || r.status}
                                </span>
                              </td>
                              <td>{formatDate(r.due_at)}</td>
                              {reportType === 'late' ? (
                                <td style={{ color: '#dc2626', fontWeight: 700 }}>{r.days_late} يوم</td>
                              ) : (
                                <td style={{ color: '#dc2626' }}>{r.not_done_reason || '—'}</td>
                              )}
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                </tbody>
                {summaryTotals && (
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                      <td>المجموع الكلي</td>
                      <td>{summaryTotals.total}</td>
                      <td>{summaryTotals.pending}</td>
                      <td>{summaryTotals.in_progress}</td>
                      <td>{summaryTotals.reported_done}</td>
                      <td style={{ color: '#059669' }}>{summaryTotals.confirmed_done}</td>
                      <td style={{ color: '#dc2626' }}>{summaryTotals.not_done}</td>
                      <td style={{ color: '#dc2626' }}>{summaryTotals.overdue}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <p className="text-muted" style={{ padding: '30px 0', textAlign: 'center' }}>
              لا توجد بيانات مسجلة لهذا التقرير حالياً.
            </p>
          )}
        </section>
      )}
    </>
  );
}
