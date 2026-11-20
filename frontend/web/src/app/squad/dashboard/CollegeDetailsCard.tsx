'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateCollegeDetailsAction, type CollegeDetails } from '@/app/actions/squad';

interface Props {
  initial: CollegeDetails;
  collegeCode: string;
}

/**
 * College details (college name + Principal's name, email and contact number), editable by
 * the college's PED. Shared by the college's Men's and Women's logins. Opens in edit mode
 * while the Principal's details are still missing.
 */
export default function CollegeDetailsCard({ initial, collegeCode }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<CollegeDetails>(initial);
  const [saved, setSaved] = useState<CollegeDetails>(initial);
  const isComplete = Boolean(saved.collegeName && saved.principalName && saved.principalEmail && saved.principalPhone);
  const [editing, setEditing] = useState(!isComplete);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof CollegeDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set('collegeName', form.collegeName);
      fd.set('principalName', form.principalName);
      fd.set('principalEmail', form.principalEmail);
      fd.set('principalPhone', form.principalPhone);
      const res = await updateCollegeDetailsAction(fd);
      if (res.success && res.details) {
        setSaved(res.details);
        setForm(res.details);
        setEditing(false);
        setNotice('College details saved.');
        // Refresh server-rendered parts (college name in the dashboard header / portal nav)
        router.refresh();
      } else {
        setError(res.error || 'Failed to save college details.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save college details.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="college-details-card"
      style={{
        background: '#fff',
        border: `1px solid ${isComplete ? '#e2e8f0' : '#f59e0b'}`,
        borderLeft: `4px solid ${isComplete ? '#800000' : '#f59e0b'}`,
        borderRadius: '12px',
        padding: 'clamp(1rem, 3vw, 1.5rem)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>College Details</h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: isComplete ? '#64748b' : '#b45309', fontWeight: 600 }}>
            {isComplete
              ? `College Code: ${collegeCode} • Shared by your college's Men's and Women's logins`
              : '⚠️ Please fill in the Principal’s details. They are shared by your college’s Men’s and Women’s logins.'}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            id="btn-edit-college-details"
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
            style={{
              background: 'none',
              border: '1px solid #cbd5e1',
              color: '#800000',
              padding: '0.4rem 0.9rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✎ Edit College Details
          </button>
        )}
      </div>

      {notice && !editing && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#059669', fontWeight: 600 }}>{notice}</div>
      )}

      {!editing ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '0.75rem', margin: '1rem 0 0' }}>
          <Field label="Name of the College" value={saved.collegeName} />
          <Field label="Name of the Principal" value={saved.principalName || '—'} />
          <Field label="Email ID of the Principal" value={saved.principalEmail || '—'} />
          <Field label="Contact Number of the Principal" value={saved.principalPhone || '—'} />
        </dl>
      ) : (
        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }} id="form-college-details">
          {error && (
            <div
              role="alert"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#dc2626',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '0.75rem',
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="college-name">Name of the College *</label>
              <input id="college-name" value={form.collegeName} onChange={set('collegeName')} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle} htmlFor="principal-name">Name of the Principal *</label>
              <input
                id="principal-name"
                value={form.principalName}
                onChange={set('principalName')}
                style={inputStyle}
                placeholder="e.g. Dr. Shylaja B. S."
                required
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="principal-email">Email ID of the Principal *</label>
              <input
                id="principal-email"
                type="email"
                value={form.principalEmail}
                onChange={set('principalEmail')}
                style={inputStyle}
                placeholder="principal@college.edu.in"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="principal-phone">Contact Number of the Principal *</label>
              <input
                id="principal-phone"
                value={form.principalPhone}
                onChange={set('principalPhone')}
                style={inputStyle}
                inputMode="tel"
                placeholder="Mobile or landline with STD code"
                autoComplete="off"
                required
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
            {isComplete && (
              <button
                type="button"
                onClick={() => {
                  setForm(saved);
                  setError(null);
                  setEditing(false);
                }}
                disabled={saving}
                style={{ background: 'none', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0.6rem 1.1rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              id="btn-save-college-details"
              disabled={saving}
              style={{
                background: '#800000',
                color: '#fff',
                border: 'none',
                padding: '0.6rem 1.4rem',
                borderRadius: '8px',
                fontWeight: 800,
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save College Details'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</dt>
      <dd style={{ margin: '0.2rem 0 0', fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: '#0f172a',
  marginBottom: '0.3rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.9rem',
  background: '#f8fafc',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  fontSize: '0.95rem',
  outline: 'none',
  boxSizing: 'border-box',
};
