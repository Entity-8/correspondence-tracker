import { useEffect, useState } from 'react';
import { api } from '../api';

const statusLabels = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد الإنجاز',
  reported_done: 'بانتظار التأكيد',
  confirmed_done: 'منجز ومؤكد',
  not_done: 'تعذر الإنجاز',
};

const urgencies = ['عاجل وعلى الفور', 'عاجل جدا', 'عاجل', 'عادي'];

const EMPTY_FILTERS = {
  sender_department_id: '',
  recipient_department_id: '',
  urgency: '',
  status: '',
  from: '',
  to: '',
  overdue: '',
};

export default function RecordsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  function load(currentFilters = filters, targetPage = page, queryOverride = searchQuery) {
    setResult(null);
    setError('');

    const params = new URLSearchParams();
    if (queryOverride.trim()) params.set('search', queryOverride.trim());
    for (const key in currentFilters) {
      if (currentFilters[key]) params.set(key, currentFilters[key]);
    }
    params.set('page', String(targetPage));
    params.set('limit', '20');

    api(`/records?${params.toString()}`)
      .then(setResult)
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    load(EMPTY_FILTERS, 1, '');
    api('/departments')
      .then(setDepartments)
      .catch(() => {});
  }, []);

  function handleFilterChange(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    load(next, 1);
  }

  function handleReset() {
    setSearchQuery('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
    load(EMPTY_FILTERS, 1, '');
  }

  function goToPage(nextPage) {
    setPage(nextPage);
    load(filters, nextPage);
  }

  const activeFiltersCount =
    Object.values(filters).filter(Boolean).length + (searchQuery.trim() ? 1 : 0);
  const records = result?.records || null;
  const total = result?.total || 0;
  const totalPages = result?.total_pages || 1;

  return (
    <>
      <section className="filter-bar">
        <div className="filter-field">
          <label>البحث بموضوع الكتاب أو رقم المرجع</label>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setPage(1);
                load(filters, 1);
              }
            }}
            placeholder="اكتب كلمة البحث..."
          />
        </div>

        <div className="filter-field">
          <label>الجهة المرسلة</label>
          <select
            value={filters.sender_department_id}
            onChange={e => handleFilterChange('sender_department_id', e.target.value)}
          >
            <option value="">كافة الجهات المرسلة</option>
            {departments.map(d => (
              <option value={d.id} key={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>الجهة المستلمة</label>
          <select
            value={filters.recipient_department_id}
            onChange={e => handleFilterChange('recipient_department_id', e.target.value)}
          >
            <option value="">كافة الجهات المستلمة</option>
            {departments.map(d => (
              <option value={d.id} key={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>درجة الاستعجال</label>
          <select
            value={filters.urgency}
            onChange={e => handleFilterChange('urgency', e.target.value)}
          >
            <option value="">كافة الدرجات</option>
            {urgencies.map(u => (
              <option value={u} key={u}>{u}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>حالة المراسلة</label>
          <select
            value={filters.status}
            onChange={e => handleFilterChange('status', e.target.value)}
          >
            <option value="">كافة الحالات</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option value={k} key={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>من تاريخ</label>
          <input
            type="date"
            value={filters.from}
            onChange={e => handleFilterChange('from', e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label>إلى تاريخ</label>
          <input
            type="date"
            value={filters.to}
            onChange={e => handleFilterChange('to', e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label>التأخير</label>
          <select
            value={filters.overdue}
            onChange={e => handleFilterChange('overdue', e.target.value)}
          >
            <option value="">الكل</option>
            <option value="true">المتأخرة فقط</option>
          </select>
        </div>

        <div className="filter-btn-group">
          <button
            className="btn btn-primary"
            onClick={() => {
              setPage(1);
              load(filters, 1);
            }}
          >
            بحث
          </button>
          {activeFiltersCount > 0 && (
            <button className="btn btn-secondary" onClick={handleReset}>
              مسح ({activeFiltersCount})
            </button>
          )}
          <a className="button-link" href="#records/new">
            ＋ تسجيل كتاب
          </a>
        </div>
      </section>

      {error && (
        <div className="alert danger">
          <span>{error}</span>
          <button className="btn btn-secondary" onClick={() => load()}>إعادة المحاولة</button>
        </div>
      )}

      {!records ? (
        <div className="skeleton">
          <i style={{ height: '50px' }} />
          <i style={{ height: '200px' }} />
        </div>
      ) : records.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '42px', marginBottom: '12px', color: '#94a3b8' }}>⌕</div>
          <h2 style={{ fontSize: '18px', color: '#0f172a', marginBottom: '8px' }}>لم يتم العثور على مراسلات</h2>
          <p style={{ color: '#64748b', fontSize: '14px', maxWidth: '420px', margin: '0 auto 20px' }}>
            جرّب تعديل كلمات البحث أو الفلاتر المحددة، أو قم بتسجيل كتاب رسمي جديد في المنظومة.
          </p>
          {activeFiltersCount > 0 && (
            <button className="btn btn-secondary" onClick={handleReset}>إلغاء تصفية النتائج</button>
          )}
        </div>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h3>قائمة المراسلات المسجلة ({total})</h3>
            <span className="text-muted" style={{ fontSize: '12.5px' }}>
              صفحة {page} من {totalPages}
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم المرجع</th>
                  <th>الموضوع</th>
                  <th>الجهة المرسلة</th>
                  <th>الجهة المستلمة</th>
                  <th>الاستعجال</th>
                  <th>الحالة الحالية</th>
                  <th>تاريخ الاستحقاق</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} onClick={() => (location.hash = `records/${r.id}`)}>
                    <td style={{ fontWeight: 700, color: '#1e3a5f', whiteSpace: 'nowrap' }}>
                      {r.reference_number || '—'}
                      {r.attachment_count > 0 && (
                        <span
                          title={`${r.attachment_count} مرفق`}
                          style={{ marginRight: '6px', fontSize: '11.5px', color: '#64748b' }}
                        >
                          📎{r.attachment_count}
                        </span>
                      )}
                    </td>
                    <td className="subject-cell">
                      <strong>{r.subject}</strong>
                    </td>
                    <td>{r.sender_name}</td>
                    <td>{r.recipient_name}</td>
                    <td>
                      <span
                        className={`urgency ${
                          r.urgency === 'عاجل وعلى الفور'
                            ? 'immediate'
                            : r.urgency === 'عاجل جدا'
                            ? 'very-urgent'
                            : r.urgency === 'عاجل'
                            ? 'urgent'
                            : 'normal'
                        }`}
                      >
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

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                السابق
              </button>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                عرض {(page - 1) * 20 + 1} – {Math.min(page * 20, total)} من أصل {total}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                التالي
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
