import { useEffect, useState } from 'react';
import { api, apiBlob } from '../api';

const readAsDataUrl = f =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    r.readAsDataURL(f);
  });

const statusLabels = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد الإنجاز',
  reported_done: 'بانتظار التأكيد',
  confirmed_done: 'منجز ومؤكد',
  not_done: 'تعذر الإنجاز',
};

function AuthorizedImage({ srcPath, alt }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = '';
    setFailed(false);
    setObjectUrl('');

    apiBlob(srcPath)
      .then(blob => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [srcPath]);

  if (failed) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
        تعذر تحميل المرفق
      </div>
    );
  }
  if (!objectUrl) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
        جاري التحميل...
      </div>
    );
  }
  return <img src={objectUrl} alt={alt} />;
}

export default function RecordDetailsPage({ id, user }) {
  const [data, setData] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [stageDescription, setStageDescription] = useState('');
  const [replyRef, setReplyRef] = useState('');
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [busy, setBusy] = useState(false);

  // Modal state: { type: 'not_done' | 'reject' | 'reminder', text: string }
  const [actionModal, setActionModal] = useState(null);

  function load() {
    setError('');
    api(`/records/${id}`)
      .then(res => {
        setData(res);
        setStageDescription(res.record?.stage || '');
        setReplyRef(res.record?.reply_reference || '');
      })
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function updateStatus(newStatus, overrideReason) {
    setError('');
    setActionSuccess('');
    const body = { status: newStatus, version: data.record.version };

    if (newStatus === 'in_progress') {
      if (!stageDescription.trim()) return setError('يرجى كتابة وصف موجز لمرحلة الإنجاز');
      body.stage = stageDescription.trim();
    }
    if (newStatus === 'reported_done') {
      body.reply_date = new Date().toISOString().slice(0, 10);
      body.reply_reference = replyRef.trim() || undefined;
      body.stage = stageDescription.trim() || undefined;
    }
    if (newStatus === 'not_done') {
      const reason = (overrideReason || '').trim();
      if (!reason) return setError('يرجى تحديد سبب تعذر الإنجاز');
      body.not_done_reason = reason;
    }

    setBusy(true);
    try {
      await api(`/records/${id}/status`, { method: 'POST', body });
      setActionSuccess('تم تحديث حالة المراسلة بنجاح');
      setActionModal(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmWorkflow(isApproved, noteText = '') {
    setError('');
    setActionSuccess('');
    setBusy(true);
    try {
      if (isApproved) {
        await api(`/records/${id}/confirm`, { method: 'POST' });
        setActionSuccess('تم تأكيد واعتماد إنجاز الكتاب بنجاح');
      } else {
        if (!noteText.trim()) return setError('يرجى إدخال سبب إعادة الكتاب وإلغاء التأكيد');
        await api(`/records/${id}/reject`, { method: 'POST', body: { note: noteText.trim() } });
        setActionSuccess('تمت إعادة المعاملة إلى قيد الإنجاز');
        setActionModal(null);
      }
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!commentText.trim()) return setError('نص التعليق مطلوب');
    setBusy(true);
    try {
      await api(`/records/${id}/comments`, { method: 'POST', body: { body: commentText.trim() } });
      setCommentText('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachFiles(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (files.length > 5) return setError('يمكن إرفاق حتى خمس صور في المرة الواحدة');
    if (files.some(f => f.size > 10 * 1024 * 1024)) return setError('الحد الأقصى لكل صورة هو 10 ميغابايت');

    setBusy(true);
    try {
      const encodedFiles = await Promise.all(
        files.map(async f => ({
          name: f.name,
          mime: f.type,
          data: await readAsDataUrl(f),
        })),
      );
      await api(`/records/${id}/attachments`, { method: 'POST', body: { files: encodedFiles } });
      setActionSuccess('تم رفع الصور والمرفقات بنجاح');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReminder(noteText) {
    setBusy(true);
    setError('');
    try {
      await api(`/records/${id}/reminders`, {
        method: 'POST',
        body: {
          note:
            noteText.trim() ||
            'تذكير رسمي: يرجى المتابعة والإفادة بالإجراء المتخذ على وجه السرعة',
        },
      });
      setActionSuccess('تم إرسال إشعار التذكير إلى الإدارة المستلمة بنجاح');
      setActionModal(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleModalSubmit(e) {
    e.preventDefault();
    if (!actionModal) return;
    if (actionModal.type === 'not_done') {
      updateStatus('not_done', actionModal.text);
    } else if (actionModal.type === 'reject') {
      confirmWorkflow(false, actionModal.text);
    } else if (actionModal.type === 'reminder') {
      sendReminder(actionModal.text);
    }
  }

  if (error && !data) {
    return (
      <div className="panel alert danger">
        <span>{error}</span>
        <a href="#records" className="btn btn-secondary">العودة للسجلات</a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="skeleton">
        <i style={{ height: '80px' }} />
        <i style={{ height: '240px' }} />
      </div>
    );
  }

  const { record: r, attachments, comments, audit, linked_record: linkedRecord, children } = data;
  const isPending = r.status === 'pending';
  const isInProgress = r.status === 'in_progress';
  const isReported = r.status === 'reported_done';
  const isConfirmed = r.status === 'confirmed_done';
  const isNotDone = r.status === 'not_done';

  return (
    <>
      <div style={{ marginBottom: '16px' }}>
        <a href="#records" className="btn btn-secondary" style={{ fontSize: '13px' }}>
          ← العودة لكافة السجلات
        </a>
      </div>

      {actionSuccess && (
        <div className="alert success">
          <span>{actionSuccess}</span>
          <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setActionSuccess('')}>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="alert danger">
          <span>{error}</span>
          <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}

      <section className="panel">
        <div className="detail-header">
          <div>
            <span className="ref-no">{r.reference_number || 'بدون رقم مرجعي'}</span>
            <h1>{r.subject}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className={`status-badge ${r.status}`} style={{ fontSize: '14px', padding: '6px 16px' }}>
              {statusLabels[r.status] || r.status}
            </span>
            {r.is_late_confirmation && (
              <span className="status-badge not_done" style={{ fontSize: '12px' }}>
                تأكيد متأخر عن الموعد
              </span>
            )}
          </div>
        </div>

        <div className="stepper-container">
          <div className={`step-node ${isPending ? 'active' : 'completed'}`}>
            <div className="step-circle">1</div>
            <span className="step-label">تسجيل الكتاب</span>
          </div>

          <div
            className={`step-node ${
              isNotDone
                ? 'not-done'
                : isInProgress
                ? 'active'
                : isReported || isConfirmed
                ? 'completed'
                : ''
            }`}
          >
            <div className="step-circle">2</div>
            <span className="step-label">{isNotDone ? 'تعذر الإنجاز' : 'قيد الإنجاز'}</span>
          </div>

          <div className={`step-node ${isReported ? 'active' : isConfirmed ? 'completed' : ''}`}>
            <div className="step-circle">3</div>
            <span className="step-label">إبلاغ بالإنجاز</span>
          </div>

          <div className={`step-node ${isConfirmed ? 'completed active' : ''}`}>
            <div className="step-circle">4</div>
            <span className="step-label">تأكيد واعتماد</span>
          </div>
        </div>

        <div className="metadata-grid">
          <div className="meta-item">
            <span className="label">الجهة المرسلة</span>
            <strong className="val">{r.sender_name}</strong>
          </div>
          <div className="meta-item">
            <span className="label">الجهة المستلمة</span>
            <strong className="val">{r.recipient_name}</strong>
          </div>
          <div className="meta-item">
            <span className="label">تاريخ صدور الكتاب</span>
            <strong className="val">{r.letter_date}</strong>
          </div>
          <div className="meta-item">
            <span className="label">تاريخ الاستحقاق الملزم</span>
            <strong className="val" style={{ color: r.is_overdue ? '#dc2626' : undefined }}>
              {new Date(r.due_at).toLocaleDateString('ar-EG')}
              {r.is_overdue && ' (متأخر)'}
            </strong>
          </div>
          <div className="meta-item">
            <span className="label">درجة الاستعجال</span>
            <div>
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
            </div>
          </div>
          {r.reply_date && (
            <div className="meta-item">
              <span className="label">تاريخ كتاب الرد</span>
              <strong className="val">
                {r.reply_date} {r.reply_reference && `(مرجع: ${r.reply_reference})`}
              </strong>
            </div>
          )}
        </div>

        {(linkedRecord || (children && children.length > 0)) && (
          <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '8px', background: '#f8fafc', border: '1px solid var(--border-default)' }}>
            {linkedRecord && (
              <div style={{ fontSize: '13px', marginBottom: children?.length ? '6px' : 0 }}>
                <strong>مرتبط بالكتاب الأساسي:</strong>{' '}
                <a href={`#records/${linkedRecord.id}`}>
                  {linkedRecord.reference_number || `#${linkedRecord.id}`} — {linkedRecord.subject}
                </a>
              </div>
            )}
            {children && children.length > 0 && (
              <div style={{ fontSize: '13px' }}>
                <strong>مراسلات فرعية مرتبطة:</strong>{' '}
                {children.map((c, idx) => (
                  <span key={c.id}>
                    {idx > 0 && ' · '}
                    <a href={`#records/${c.id}`}>
                      {c.reference_number || `#${c.id}`} ({c.subject})
                    </a>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {r.is_overdue && (
          <div className="alert danger" style={{ marginTop: '14px' }}>
            <div>
              <strong>كتاب متأخر:</strong> تجاوزت هذه المراسلة موعد الاستحقاق النهائي المحدد في المنظومة.
            </div>
          </div>
        )}

        {r.status === 'not_done' && (
          <div className="alert danger" style={{ background: '#fff1f2', marginTop: '14px' }}>
            <div>
              <strong>سبب تعذر الإنجاز:</strong> {r.not_done_reason || 'لم يتم تحديد سبب.'}
            </div>
          </div>
        )}

        {r.stage && (
          <div className="alert warning" style={{ marginTop: '14px' }}>
            <div>
              <strong>المرحلة الحالية للإنجاز:</strong> {r.stage}
            </div>
          </div>
        )}

        <div style={{ marginTop: '24px' }}>
          <div className="panel-header" style={{ marginBottom: '12px' }}>
            <h3>الوثائق والصور المرفقة ({attachments?.length || 0})</h3>
            {user.role !== 'System admin' && (
              <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: '13px' }}>
                📎 إرفاق صور إضافية
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleAttachFiles}
                  disabled={busy}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>

          {attachments && attachments.length > 0 ? (
            <div className="gallery-grid">
              {attachments.map(att => (
                <div
                  className="gallery-card"
                  key={att.id}
                  onClick={() => setSelectedImage(att)}
                  title="انقر للمعاينة بحجم كامل"
                >
                  <AuthorizedImage
                    srcPath={`/records/${id}/attachments/${att.id}`}
                    alt={att.original_name}
                  />
                  <div className="img-overlay">{att.original_name}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted" style={{ padding: '12px 0' }}>
              لا توجد صور أو مرفقات مرفوعة مع هذا الكتاب.
            </p>
          )}
        </div>

        <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--border-default)' }}>
          {user.department_id === r.recipient_department_id && r.status !== 'confirmed_done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ fontSize: '14.5px', color: '#1e3a5f' }}>اتخاذ إجراء على الكتاب:</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="وصف المرحلة الحالية (عند بدء الإنجاز)"
                  value={stageDescription}
                  onChange={e => setStageDescription(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  placeholder="رقم كتاب الرد الرسمي (عند إبلاغ الإنجاز)"
                  value={replyRef}
                  onChange={e => setReplyRef(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => updateStatus('in_progress')}
                >
                  بدء الإنجاز وتحديث المرحلة
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={busy}
                  onClick={() => updateStatus('reported_done')}
                >
                  ✓ إبلاغ بالإنجاز والرد
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  disabled={busy}
                  onClick={() => setActionModal({ type: 'not_done', text: r.not_done_reason || '' })}
                >
                  تعذر الإنجاز
                </button>
              </div>
            </div>
          )}

          {user.role === 'Registrar' && r.status === 'reported_done' && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
              <span style={{ fontWeight: 600 }}>إجراء أمانة السر على الكتاب المنجز:</span>
              <button
                type="button"
                className="btn btn-success"
                disabled={busy}
                onClick={() => confirmWorkflow(true)}
              >
                ✓ اعتماد وتأكيد الإنجاز
              </button>
              <button
                type="button"
                className="btn btn-outline-danger"
                disabled={busy}
                onClick={() => setActionModal({ type: 'reject', text: '' })}
              >
                إعادة للجهة مع الملاحظات
              </button>
            </div>
          )}

          {['Supervisor', 'Registrar'].includes(user.role) && r.status !== 'confirmed_done' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  setActionModal({
                    type: 'reminder',
                    text: 'تذكير رسمي: يرجى المتابعة والإفادة بالإجراء المتخذ على وجه السرعة',
                  })
                }
              >
                📢 إرسال إشعار تذكير رسمي للمستلم
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="two-cols-layout">
        <section className="panel">
          <div className="panel-header">
            <h3>التعليقات والملاحظات الداخلية ({comments?.length || 0})</h3>
          </div>

          <div style={{ maxHeight: '350px', overflowY: 'auto', marginBottom: '16px' }}>
            {comments && comments.length > 0 ? (
              comments.map(c => (
                <div className="comment-card" key={c.id}>
                  <div className="comment-header">
                    <span className="comment-author">{c.display_name}</span>
                    <span className="comment-time">{new Date(c.created_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="comment-body">{c.body}</div>
                </div>
              ))
            ) : (
              <p className="text-muted" style={{ padding: '12px 0' }}>لا توجد تعليقات بعد.</p>
            )}
          </div>

          <form onSubmit={handleAddComment}>
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <textarea
                rows={3}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="أضف ملاحظة أو توجيهاً داخلياً..."
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              حفظ التعليق
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>سجل حركة الكتاب والتدقيق</h3>
          </div>

          <div className="timeline-feed" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {audit &&
              audit.map(a => (
                <div className="timeline-item" key={a.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{a.display_name}</strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {new Date(a.changed_at).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#475569' }}>
                    <span>{statusLabels[a.old_status] || 'تسجيل'}</span> ←{' '}
                    <strong style={{ color: '#1e3a5f' }}>
                      {statusLabels[a.new_status] || a.new_status}
                    </strong>
                  </div>
                  {a.note && (
                    <div
                      style={{
                        fontSize: '12px',
                        background: '#f8fafc',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #f1f5f9',
                      }}
                    >
                      {a.note}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </section>
      </div>

      {selectedImage && (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong style={{ fontSize: '14.5px' }}>{selectedImage.original_name}</strong>
              <button className="btn btn-secondary" onClick={() => setSelectedImage(null)}>
                إغلاق ✕
              </button>
            </div>
            <div className="modal-body">
              <AuthorizedImage
                srcPath={`/records/${id}/attachments/${selectedImage.id}`}
                alt={selectedImage.original_name}
              />
            </div>
          </div>
        </div>
      )}

      {actionModal && (
        <div className="modal-backdrop" onClick={() => setActionModal(null)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>
                {actionModal.type === 'not_done'
                  ? 'بيان سبب تعذر الإنجاز'
                  : actionModal.type === 'reject'
                  ? 'إعادة الكتاب للاستكمال'
                  : 'إرسال إشعار تذكير رسمي'}
              </strong>
              <button type="button" className="btn btn-secondary" onClick={() => setActionModal(null)}>
                إغلاق ✕
              </button>
            </div>
            <form onSubmit={handleModalSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <textarea
                rows={4}
                autoFocus
                value={actionModal.text}
                onChange={e => setActionModal({ ...actionModal, text: e.target.value })}
                placeholder={
                  actionModal.type === 'not_done'
                    ? 'اكتب سبب تعذر إنجاز الكتاب بوضوح...'
                    : actionModal.type === 'reject'
                    ? 'اكتب سبب إعادة المعاملة والملاحظات المطلوبة...'
                    : 'اكتب نص التذكير الموجه للإدارة المستلمة...'
                }
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActionModal(null)}>
                  إلغاء
                </button>
                <button
                  type="submit"
                  className={actionModal.type === 'reminder' ? 'btn btn-primary' : 'btn btn-danger'}
                  disabled={busy}
                >
                  {busy
                    ? 'جاري التنفيذ...'
                    : actionModal.type === 'not_done'
                    ? 'تأكيد تعذر الإنجاز'
                    : actionModal.type === 'reject'
                    ? 'إعادة للجهة المستلمة'
                    : 'إرسال التذكير'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
