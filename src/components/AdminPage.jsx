import { useEffect, useState } from 'react';
import { api } from '../api';

const roleLabels = {
  'System admin': { label: 'مدير نظام', badge: 'role-admin', icon: '🛡️' },
  'Supervisor': { label: 'إشراف ومتابعة', badge: 'role-supervisor', icon: '👁️' },
  'Registrar': { label: 'أمانة السر', badge: 'role-registrar', icon: '📝' },
  'Unit': { label: 'جهة تنفيذية', badge: 'role-unit', icon: '🏢' }
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'admins', 'departments'
  const [userData, setUserData] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [alert, setAlert] = useState({ text: '', isError: false });

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalUser, setEditModalUser] = useState(null);
  const [passwordModalUser, setPasswordModalUser] = useState(null);

  // Form states
  const [createForm, setCreateForm] = useState({
    username: '',
    display_name: '',
    password: '',
    role: 'Unit',
    department_id: ''
  });
  const [editForm, setEditForm] = useState({
    display_name: '',
    role: '',
    department_id: '',
    is_active: 1
  });
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    Promise.all([api('/admin/users'), api('/admin/departments')])
      .then(([usersRes, deptsRes]) => {
        setUserData(usersRes);
        setDepartments(deptsRes.departments || []);
      })
      .catch(e => setAlert({ text: e.message, isError: true }));
  }

  useEffect(() => {
    load();
  }, []);

  function showAlert(text, isError = false) {
    setAlert({ text, isError });
    setTimeout(() => {
      setAlert(prev => (prev.text === text ? { text: '', isError: false } : prev));
    }, 4500);
  }

  function generateStrongPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  // Handle Create User / Admin
  async function handleCreateUser(e) {
    e.preventDefault();
    if (!createForm.username.trim()) return showAlert('اسم المستخدم مطلوب', true);
    if (!createForm.display_name.trim()) return showAlert('الاسم الظاهر مطلوب', true);
    if (createForm.password.length < 8) return showAlert('كلمة المرور يجب ألا تقل عن 8 أحرف', true);
    if (createForm.role !== 'System admin' && !createForm.department_id) {
      return showAlert('يرجى اختيار الإدارة التابع لها المستخدم', true);
    }

    setBusy(true);
    try {
      await api('/admin/users', { method: 'POST', body: createForm });
      showAlert('تم إنشاء الحساب بنجاح وتم منحه الصلاحيات المحددة.');
      setCreateModalOpen(false);
      setCreateForm({ username: '', display_name: '', password: '', role: 'Unit', department_id: '' });
      load();
    } catch (err) {
      showAlert(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  // Handle Edit User
  async function handleEditUser(e) {
    e.preventDefault();
    if (!editModalUser) return;
    if (!editForm.display_name.trim()) return showAlert('الاسم الظاهر مطلوب', true);

    setBusy(true);
    try {
      await api(`/admin/users/${editModalUser.id}`, { method: 'PUT', body: editForm });
      showAlert('تم تحديث بيانات المستخدم بنجاح.');
      setEditModalUser(null);
      load();
    } catch (err) {
      showAlert(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  // Handle Reset Password
  async function handleResetPassword(e) {
    e.preventDefault();
    if (!passwordModalUser) return;
    if (newPassword.length < 8) return showAlert('كلمة المرور يجب أن تتكون من 8 أحرف على الأقل', true);

    setBusy(true);
    try {
      await api(`/admin/users/${passwordModalUser.id}/reset-password`, {
        method: 'POST',
        body: { password: newPassword }
      });
      showAlert(`تم تغيير كلمة المرور للمستخدم (${passwordModalUser.username}) وإبطال كافة جلساته السابقة بنجاح.`);
      setPasswordModalUser(null);
      setNewPassword('');
    } catch (err) {
      showAlert(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  // Handle Toggle Active/Inactive Status
  async function handleToggleStatus(user) {
    const action = user.is_active ? 'deactivate' : 'reactivate';
    const confirmMsg = user.is_active
      ? `هل أنت متأكد من تعطيل حساب (${user.display_name})؟ لن يتمكن من تسجيل الدخول فوراً.`
      : `هل تريد إعادة تفعيل حساب (${user.display_name})؟`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await api(`/admin/users/${user.id}/${action}`, { method: 'POST' });
      showAlert(user.is_active ? 'تم إيقاف الحساب بنجاح.' : 'تم إعادة تفعيل الحساب بنجاح.');
      load();
    } catch (err) {
      showAlert(err.message, true);
    }
  }

  // Handle Rename Department
  async function handleRenameDept(dep) {
    const newName = window.prompt('يرجى كتابة الاسم الجديد للإدارة / المعاونية:', dep.name);
    if (newName && newName.trim() !== dep.name) {
      try {
        await api(`/admin/departments/${dep.id}`, { method: 'PUT', body: { name: newName.trim() } });
        showAlert('تم تعديل مسمى الإدارة بنجاح.');
        load();
      } catch (err) {
        showAlert(err.message, true);
      }
    }
  }

  // Compute Filtered Users
  const allUsers = userData?.users || [];
  const admins = allUsers.filter(u => u.role === 'System admin');
  const supervisors = allUsers.filter(u => u.role === 'Supervisor' || u.role === 'Registrar');
  const units = allUsers.filter(u => u.role === 'Unit');
  const inactiveCount = allUsers.filter(u => !u.is_active).length;

  const displayedUsers = allUsers.filter(u => {
    if (activeTab === 'admins' && u.role !== 'System admin') return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchName = (u.display_name || '').toLowerCase().includes(q);
      const matchUser = (u.username || '').toLowerCase().includes(q);
      if (!matchName && !matchUser) return false;
    }
    if (filterRole && u.role !== filterRole) return false;
    if (filterDept && String(u.department_id) !== String(filterDept)) return false;
    if (filterStatus === 'active' && !u.is_active) return false;
    if (filterStatus === 'inactive' && u.is_active) return false;
    return true;
  });

  return (
    <>
      {/* Alert Callout */}
      {alert.text && (
        <div className={`alert ${alert.isError ? 'danger' : 'success'}`}>
          <span>{alert.text}</span>
          <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setAlert({ text: '', isError: false })}>
            ×
          </button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card navy">
          <div className="stat-header">
            <span className="stat-label">إجمالي الحسابات المسجلة</span>
          </div>
          <div className="stat-value">{allUsers.length}</div>
        </div>

        <div className="stat-card" style={{ borderTop: '4px solid #8b5cf6' }}>
          <div className="stat-header">
            <span className="stat-label">مدراء النظام (Admins)</span>
          </div>
          <div className="stat-value" style={{ color: '#6d28d9' }}>{admins.length}</div>
        </div>

        <div className="stat-card teal">
          <div className="stat-header">
            <span className="stat-label">المشرفون وأمانة السر</span>
          </div>
          <div className="stat-value">{supervisors.length}</div>
        </div>

        <div className="stat-card" style={{ borderTop: '4px solid #059669' }}>
          <div className="stat-header">
            <span className="stat-label">الجهات التنفيذية (Units)</span>
          </div>
          <div className="stat-value" style={{ color: '#059669' }}>{units.length}</div>
        </div>

        <div className="stat-card red">
          <div className="stat-header">
            <span className="stat-label">الحسابات الموقوفة</span>
          </div>
          <div className="stat-value" style={{ color: inactiveCount > 0 ? '#dc2626' : undefined }}>
            {inactiveCount}
          </div>
        </div>
      </div>

      {/* Top Header & Tab Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', background: '#e2e8f0', padding: '4px', borderRadius: '8px' }}>
          <button
            type="button"
            className={activeTab === 'all' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ padding: '8px 16px', fontSize: '13.5px' }}
            onClick={() => setActiveTab('all')}
          >
            👥 كافة المستخدمين ({allUsers.length})
          </button>
          <button
            type="button"
            className={activeTab === 'admins' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ padding: '8px 16px', fontSize: '13.5px' }}
            onClick={() => setActiveTab('admins')}
          >
            🛡️ مدراء النظام ({admins.length})
          </button>
          <button
            type="button"
            className={activeTab === 'departments' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ padding: '8px 16px', fontSize: '13.5px' }}
            onClick={() => setActiveTab('departments')}
          >
            🏢 دليل الإدارات ({departments.length})
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '10px 20px', fontSize: '14px', boxShadow: '0 4px 10px rgba(37,99,235,0.25)' }}
          onClick={() => {
            setCreateForm({
              username: '',
              display_name: '',
              password: generateStrongPassword(),
              role: activeTab === 'admins' ? 'System admin' : 'Unit',
              department_id: ''
            });
            setCreateModalOpen(true);
          }}
        >
          ＋ إضافة حساب جديد (مستخدم أو مدير)
        </button>
      </div>

      {/* View 1 & 2: Users & Admins Tables */}
      {activeTab !== 'departments' ? (
        <section className="panel">
          {/* Search & Filter Bar */}
          <div className="filter-bar" style={{ padding: '16px', marginBottom: '16px', gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
            <div className="filter-field">
              <label>بحث بالاسم أو اسم المستخدم</label>
              <input
                type="text"
                placeholder="اكتب اسم الحساب أو اسم الدخول..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {activeTab !== 'admins' && (
              <div className="filter-field">
                <label>تصفية حسب الدور</label>
                <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                  <option value="">كافة الأدوار</option>
                  <option value="System admin">مدير نظام</option>
                  <option value="Supervisor">إشراف ومتابعة</option>
                  <option value="Registrar">أمانة السر</option>
                  <option value="Unit">جهة تنفيذية</option>
                </select>
              </div>
            )}

            <div className="filter-field">
              <label>تصفية حسب الإدارة</label>
              <select value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                <option value="">كافة الإدارات</option>
                {departments.map(d => (
                  <option value={d.id} key={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>حالة الحساب</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">كافة الحالات</option>
                <option value="active">فعّال فقط</option>
                <option value="inactive">موقوف فقط</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              {(search || filterRole || filterDept || filterStatus) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearch('');
                    setFilterRole('');
                    setFilterDept('');
                    setFilterStatus('');
                  }}
                >
                  مسح الفلاتر
                </button>
              )}
            </div>
          </div>

          {/* Users Table */}
          {!userData ? (
            <div className="skeleton">
              <i style={{ height: '50px' }} />
              <i style={{ height: '240px' }} />
            </div>
          ) : displayedUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: '#64748b' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>👤</div>
              <h4>لم يتم العثور على حسابات مطابقة للبحث</h4>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المعرف</th>
                    <th>اسم الدخول (Username)</th>
                    <th>الاسم الظاهر</th>
                    <th>الدور والصلاحية</th>
                    <th>الإدارة / التبعية</th>
                    <th>الحالة</th>
                    <th>تاريخ التسجيل</th>
                    <th style={{ textAlign: 'center' }}>إجراءات الإدارة</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map(u => {
                    const roleInfo = roleLabels[u.role] || { label: u.role, icon: '•' };
                    return (
                      <tr key={u.id}>
                        <td style={{ color: '#94a3b8', fontWeight: 600 }}>#{u.id}</td>
                        <td style={{ fontWeight: 700, color: '#1e3a5f' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: u.role === 'System admin' ? '#6d28d9' : '#1e3a5f',
                              color: '#fff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '11px',
                              fontWeight: 700
                            }}>
                              {u.username[0]?.toUpperCase()}
                            </span>
                            {u.username}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{u.display_name}</td>
                        <td>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            background: u.role === 'System admin' ? '#f5f3ff' : '#eff6ff',
                            color: u.role === 'System admin' ? '#6d28d9' : '#1d4ed8',
                            border: `1px solid ${u.role === 'System admin' ? '#ddd6fe' : '#bfdbfe'}`
                          }}>
                            {roleInfo.icon} {roleInfo.label}
                          </span>
                        </td>
                        <td>
                          {u.department_name ? (
                            <span style={{ color: '#334155' }}>{u.department_name}</span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>— إشراف عام للمكتب</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge ${u.is_active ? 'confirmed_done' : 'not_done'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                            {u.is_active ? 'فعّال' : 'موقوف'}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: '#64748b' }}>
                          {new Date(u.created_at).toLocaleDateString('ar-EG')}
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => {
                                setEditModalUser(u);
                                setEditForm({
                                  display_name: u.display_name,
                                  role: u.role,
                                  department_id: u.department_id || '',
                                  is_active: u.is_active
                                });
                              }}
                              title="تعديل المسمى والدور"
                            >
                              ✏️ تعديل
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => {
                                setPasswordModalUser(u);
                                setNewPassword(generateStrongPassword());
                              }}
                              title="إعادة تعيين كلمة المرور"
                            >
                              🔑 كلمة المرور
                            </button>
                            <button
                              type="button"
                              className={u.is_active ? 'btn btn-outline-danger' : 'btn btn-success'}
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => handleToggleStatus(u)}
                            >
                              {u.is_active ? 'إيقاف' : 'تفعيل'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        /* View 3: Departments Catalog */
        <section className="panel">
          <div className="panel-header">
            <h3>دليل الإدارات والمعاونيات المعتمدة ({departments.length})</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>اسم الإدارة / المعاونية</th>
                  <th>نوع الدور الافتراضي</th>
                  <th>ضمن مكتب الرئيس</th>
                  <th>إجراء التعديل</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>#{d.id}</td>
                    <td style={{ fontWeight: 700, color: '#1e3a5f' }}>{d.name}</td>
                    <td>
                      <span className="ref-badge" style={{ fontSize: '12px' }}>{d.role}</span>
                    </td>
                    <td>{d.is_head_office ? 'نعم (مكتب الرئيس)' : 'لا'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={() => handleRenameDept(d)}
                      >
                        ✏️ تعديل المسمى
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =====================================================================
          Modal 1: Create New User / Admin Modal
          ===================================================================== */}
      {createModalOpen && (
        <div className="modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '16px', color: '#1e3a5f' }}>إضافة مستخدم أو مدير نظام جديد</h3>
              <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setCreateModalOpen(false)}>×</button>
            </div>

            <form onSubmit={handleCreateUser} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  الدور والصلاحية <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { key: 'Unit', label: 'جهة تنفيذية (Unit)', icon: '🏢' },
                    { key: 'Supervisor', label: 'إشراف ومتابعة (Supervisor)', icon: '👁️' },
                    { key: 'Registrar', label: 'أمانة السر (Registrar)', icon: '📝' },
                    { key: 'System admin', label: 'مدير نظام شامل (Admin)', icon: '🛡️' }
                  ].map(r => (
                    <label
                      key={r.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: `1.5px solid ${createForm.role === r.key ? '#2563eb' : '#e2e8f0'}`,
                        background: createForm.role === r.key ? '#eff6ff' : '#ffffff',
                        cursor: 'pointer',
                        fontSize: '12.5px',
                        fontWeight: createForm.role === r.key ? 700 : 500
                      }}
                    >
                      <input
                        type="radio"
                        name="create-role"
                        checked={createForm.role === r.key}
                        onChange={() => setCreateForm({ ...createForm, role: r.key, department_id: r.key === 'System admin' ? '' : createForm.department_id })}
                      />
                      <span>{r.icon} {r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    اسم المستخدم للدخول (Username) <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.username}
                    onChange={e => setCreateForm({ ...createForm, username: e.target.value })}
                    placeholder="مثال: admin_ali أو unit20"
                  />
                </div>

                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    الاسم الظاهر / المسمى <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.display_name}
                    onChange={e => setCreateForm({ ...createForm, display_name: e.target.value })}
                    placeholder="مثال: علي حسن (معاون مدير)"
                  />
                </div>
              </div>

              {/* Department Selector (Disabled if System Admin) */}
              {createForm.role !== 'System admin' ? (
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    الإدارة أو المعاونية التابع لها <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <select
                    required
                    value={createForm.department_id}
                    onChange={e => setCreateForm({ ...createForm, department_id: e.target.value })}
                  >
                    <option value="">اختر الإدارة</option>
                    {departments
                      .filter(d => d.role === createForm.role || (createForm.role === 'Supervisor' && d.role === 'Supervisor'))
                      .map(d => (
                        <option value={d.id} key={d.id}>{d.id} — {d.name}</option>
                      ))}
                  </select>
                </div>
              ) : (
                <div style={{ background: '#f5f3ff', padding: '10px 14px', borderRadius: '6px', fontSize: '12.5px', color: '#6d28d9', border: '1px solid #ddd6fe' }}>
                  🛡️ حساب مدير النظام يمتلك صلاحيات إدارية شاملة ولا يرتبط بإدارة معينة.
                </div>
              )}

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>
                    كلمة المرور الابتدائية <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                    onClick={() => setCreateForm({ ...createForm, password: generateStrongPassword() })}
                  >
                    توليد كلمة مرور عشوائية ⟳
                  </button>
                </div>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={createForm.password}
                  onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCreateModalOpen(false)}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'جاري الحفظ...' : '✓ إنشاء الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          Modal 2: Edit User Modal
          ===================================================================== */}
      {editModalUser && (
        <div className="modal-backdrop" onClick={() => setEditModalUser(null)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '16px' }}>تعديل بيانات الحساب: {editModalUser.username}</h3>
              <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setEditModalUser(null)}>×</button>
            </div>

            <form onSubmit={handleEditUser} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>الاسم الظاهر</label>
                <input
                  type="text"
                  required
                  value={editForm.display_name}
                  onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>الدور الوظيفي</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value, department_id: e.target.value === 'System admin' ? '' : editForm.department_id })}
                >
                  <option value="System admin">مدير نظام (System admin)</option>
                  <option value="Supervisor">إشراف ومتابعة (Supervisor)</option>
                  <option value="Registrar">أمانة السر (Registrar)</option>
                  <option value="Unit">جهة تنفيذية (Unit)</option>
                </select>
              </div>

              {editForm.role !== 'System admin' && (
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>الإدارة التابع لها</label>
                  <select
                    value={editForm.department_id}
                    onChange={e => setEditForm({ ...editForm, department_id: e.target.value })}
                  >
                    <option value="">اختر الإدارة</option>
                    {departments.map(d => (
                      <option value={d.id} key={d.id}>{d.id} — {d.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditModalUser(null)}>إلغاء</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'جاري التحديث...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          Modal 3: Reset Password Modal
          ===================================================================== */}
      {passwordModalUser && (
        <div className="modal-backdrop" onClick={() => setPasswordModalUser(null)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '16px' }}>إعادة تعيين كلمة المرور</h3>
              <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setPasswordModalUser(null)}>×</button>
            </div>

            <form onSubmit={handleResetPassword} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: '#64748b' }}>
                المستخدم المستهدف: <strong>{passwordModalUser.display_name} ({passwordModalUser.username})</strong>
              </p>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>كلمة المرور الجديدة</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                    onClick={() => setNewPassword(generateStrongPassword())}
                  >
                    توليد كلمة سر ⟳
                  </button>
                </div>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                />
              </div>

              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '10px', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>
                ⚠️ سيتم إبطال جميع جلسات الدخول الحالية للمستخدم فوراً، وسيتعين عليه استخدام كلمة المرور الجديدة.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPasswordModalUser(null)}>إلغاء</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'جاري الحفظ...' : 'تأكيد تغيير كلمة المرور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
