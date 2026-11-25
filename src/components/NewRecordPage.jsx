import { useEffect, useState } from 'react';
import { api } from '../api';

const readAsDataUrl = f =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    r.readAsDataURL(f);
  });

const urgencyOptions = [
  { key: 'عاجل وعلى الفور', label: 'عاجل وعلى الفور', desc: 'استحقاق خلال 24 ساعة', badge: 'immediate' },
  { key: 'عاجل جدا', label: 'عاجل جداً', desc: 'استحقاق خلال 48 ساعة', badge: 'very-urgent' },
  { key: 'عاجل', label: 'عاجل', desc: 'استحقاق خلال 72 ساعة', badge: 'urgent' },
  { key: 'عادي', label: 'عادي', desc: 'استحقاق خلال 5 أيام أو محدد في الكتاب', badge: 'normal' },
];

export default function NewRecordPage({ user }) {
  const isUnit = user.role === 'Unit';
  const [departments, setDepartments] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);
  const [form, setForm] = useState({
    letter_date: new Date().toISOString().slice(0, 10),
    subject: '',
    urgency: 'عادي',
    sender_department_id: user.department_id || '',
    recipient_department_ids: [],
    reference_number: '',
    due_date_in_letter: '',
    linked_record_id: '',
  });
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/departments')
      .then(setDepartments)
      .catch(e => {
        setMessage(e.message);
        setIsError(true);
      });
    api('/records?limit=50')
      .then(res => setRecentRecords(res.records || []))
      .catch(() => {});
  }, []);

  function handleChange(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function toggleRecipient(deptId) {
    const idStr = String(deptId);
    setForm(prev => {
      const exists = prev.recipient_department_ids.includes(idStr);
      return {
        ...prev,
        recipient_department_ids: exists
          ? prev.recipient_department_ids.filter(x => x !== idStr)
          : [...prev.recipient_department_ids, idStr],
      };
    });
  }

  function selectAllRecipients() {
    const available = departments
      .filter(d => String(d.id) !== String(form.sender_department_id))
      .map(d => String(d.id));
    setForm(prev => ({ ...prev, recipient_department_ids: available }));
  }

  function clearAllRecipients() {
    setForm(prev => ({ ...prev, recipient_department_ids: [] }));
  }

  function handleFilePick(e) {
    const list = [...e.target.files];
    if (list.length > 5) {
      setMessage('الحد الأقصى هو خمس صور للكتاب الواحد');
      setIsError(true);
      return;
    }
    if (list.some(x => x.size > 10 * 1024 * 1024)) {
      setMessage('حجم كل صورة يجب ألا يتجاوز 10 ميغابايت');
      setIsError(true);
      return;
    }
    if (list.some(x => !['image/jpeg', 'image/png', 'image/webp'].includes(x.type))) {
      setMessage('أنواع الملفات المسموحة: JPG أو PNG أو WebP');
      setIsError(true);
      return;
    }
    setMessage('');
    setIsError(false);
    setFiles(list);
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');
    setIsError(false);

    if (!form.letter_date) {
      setMessage('تاريخ صدور الكتاب مطلوب');
      setIsError(true);
      return;
    }
    if (!form.subject.trim()) {
      setMessage('موضوع الكتاب مطلوب');
      setIsError(true);
      return;
    }
    if (!form.sender_department_id) {
      setMessage('جهة الإرسال مطلوبة');
      setIsError(true);
      return;
    }
    if (!form.recipient_department_ids.length) {
      setMessage('يرجى اختيار جهة مستلمة واحدة على الأقل');
      setIsError(true);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ...form,
        subject: form.subject.trim(),
        reference_number: form.reference_number.trim() || undefined,
        due_date_in_letter: form.due_date_in_letter || undefined,
        linked_record_id: form.linked_record_id ? Number(form.linked_record_id) : undefined,
      };

      const res = await api('/records', { method: 'POST', body: payload });

      if (files.length) {
        const filePayload = {
          files: await Promise.all(
            files.map(async f => ({
              name: f.name,
              mime: f.type,
              data: await readAsDataUrl(f),
            })),
          ),
        };
        for (const record of res.records) {
          await api(`/records/${record.id}/attachments`, { method: 'POST', body: filePayload });
        }
      }

      setMessage(`تم تسجيل وإصدار ${res.records.length} كتاب بنجاح بمواعيد استحقاق آلية.`);
      setIsError(false);
      setForm(prev => ({
        ...prev,
        subject: '',
        reference_number: '',
        recipient_department_ids: [],
        due_date_in_letter: '',
        linked_record_id: '',
      }));
      setFiles([]);
      const fileInput = document.getElementById('letter-images-input');
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setMessage(err.message);
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  const senderDepartments = isUnit
    ? departments.filter(x => x.id === user.department_id)
    : departments.filter(x => Boolean(x.is_head_office));

  const eligibleRecipients = departments.filter(
    x => String(x.id) !== String(form.sender_department_id),
  );

  return (
    <section className="panel" style={{ maxWidth: '960px', margin: '0 auto' }}>
      <div className="panel-header">
        <div>
          <h2>تسجيل وتعميم كتاب رسمي جديد</h2>
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
            سيتم احتساب تاريخ الاستحقاق وتوزيع المراسلة تلقائياً على سجلات الإدارات المختارة.
          </p>
        </div>
      </div>

      {message && (
        <div className={`alert ${isError ? 'danger' : 'success'}`}>
          <span>{message}</span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '2px 8px' }}
            onClick={() => setMessage('')}
          >
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div className="form-group">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              رقم المرجع / العدد (اختياري)
            </label>
            <input
              type="text"
              value={form.reference_number}
              onChange={e => handleChange('reference_number', e.target.value)}
              placeholder="مثال: م ب/104"
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              تاريخ الكتاب <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="date"
              value={form.letter_date}
              onChange={e => handleChange('letter_date', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              الجهة الصادر منها <span style={{ color: '#dc2626' }}>*</span>
            </label>
            {isUnit ? (
              <input
                type="text"
                readOnly
                value={user.department_name || ''}
                style={{ background: '#f1f5f9', cursor: 'not-allowed' }}
              />
            ) : (
              <select
                value={form.sender_department_id}
                onChange={e => handleChange('sender_department_id', e.target.value)}
              >
                <option value="">اختر جهة الإرسال</option>
                {senderDepartments.map(d => (
                  <option value={d.id} key={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              ربط بمعاملة سابقة (اختياري)
            </label>
            <select
              value={form.linked_record_id}
              onChange={e => handleChange('linked_record_id', e.target.value)}
            >
              <option value="">بدون ربط</option>
              {recentRecords.map(rec => (
                <option value={rec.id} key={rec.id}>
                  {(rec.reference_number || `#${rec.id}`) + ' — ' + rec.subject.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
            درجة الاستعجال والمهلة الزمنية <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {urgencyOptions.map(opt => {
              const isSelected = form.urgency === opt.key;
              return (
                <div
                  key={opt.key}
                  onClick={() => handleChange('urgency', opt.key)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: `2px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '14px', color: isSelected ? '#1e3a5f' : '#0f172a' }}>
                      {opt.label}
                    </strong>
                    <span className={`urgency ${opt.badge}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                      {isSelected ? '✓ محدد' : ''}
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block', marginTop: '4px' }}>
                    {opt.desc}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {form.urgency === 'عادي' && (
          <div className="form-group" style={{ maxWidth: '320px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              تاريخ استحقاق محدد في نص الكتاب (اختياري)
            </label>
            <input
              type="date"
              value={form.due_date_in_letter}
              onChange={e => handleChange('due_date_in_letter', e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600 }}>
              الجهات المستلمة والمكلفة بالإجراء ({form.recipient_department_ids.length} محددة){' '}
              <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={selectAllRecipients}>
                تحديد كافة الإدارات
              </button>
              <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={clearAllRecipients}>
                إلغاء التحديد
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: '8px',
              maxHeight: '220px',
              overflowY: 'auto',
              padding: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
            }}
          >
            {eligibleRecipients.map(dept => {
              const isChecked = form.recipient_department_ids.includes(String(dept.id));
              return (
                <label
                  key={dept.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: isChecked ? '#dbeafe' : '#ffffff',
                    border: `1px solid ${isChecked ? '#93c5fd' : '#e2e8f0'}`,
                    cursor: 'pointer',
                    fontSize: '12.5px',
                    fontWeight: isChecked ? 600 : 400,
                    color: isChecked ? '#1e3a5f' : '#0f172a',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleRecipient(dept.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>{dept.name}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
            موضوع الكتاب / التوجيه <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <textarea
            rows={3}
            value={form.subject}
            onChange={e => handleChange('subject', e.target.value)}
            placeholder="اكتب خلاصة وموضوع الكتاب الرسمي..."
          />
        </div>

        <div className="form-group">
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
            المرفقات وصور الكتب الرسمية (اختياري)
          </label>
          <div
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: '8px',
              padding: '20px',
              textAlign: 'center',
              background: '#f8fafc',
            }}
          >
            <input
              id="letter-images-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFilePick}
              style={{ display: 'none' }}
            />
            <label htmlFor="letter-images-input" style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '28px', color: '#64748b', marginBottom: '6px' }}>📎</div>
              <strong style={{ fontSize: '14px', color: '#1e3a5f', display: 'block' }}>
                انقر هنا لاختيار صور المرفقات
              </strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                (JPG أو PNG أو WebP · حتى 5 صور · الحد الأقصى 10 ميغابايت لكل صورة)
              </span>
            </label>
            {files.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                {files.map((f, idx) => (
                  <span
                    key={`${f.name}-${idx}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: '#dcfce7',
                      color: '#166534',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    {f.name}
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 700 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ minWidth: '180px', padding: '12px 24px' }}>
            {busy ? 'جاري التسجيل والرفع...' : '✓ اعتماد وتسجيل المراسلة'}
          </button>
        </div>
      </form>
    </section>
  );
}
