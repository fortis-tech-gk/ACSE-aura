'use client';

/**
 * Contingent portal → PED Passes.
 *
 * A college's Physical Education Director(s) get a free pass (purple P.E.D. card) with a QR
 * that is scanned at the food counters and, if they asked for it, at the hostel. No fee and
 * no check-in. The PED can add / correct their college's PED rows here, or upload sheet 2 of
 * the Excel workbook. (ACS faculty, volunteers and officials are the meet office's.)
 */

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BLOOD_GROUPS, PED_DESIGNATION, SCOPE_LABEL } from '@/lib/delegates';
import {
  addSquadDelegateAction,
  deleteSquadDelegateAction,
  importSquadDelegatesAction,
  updateSquadDelegateAction,
  type DelegateWithQr,
  type ImportResult,
} from '@/app/actions/delegates';

interface Props {
  delegates: DelegateWithQr[];
  canEdit: boolean;
  blockReason: string | null;
  collegeName: string;
  collegeCode: string;
}

export default function FacultyManager({ delegates, canEdit, blockReason, collegeName, collegeCode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [editing, setEditing] = useState<DelegateWithQr | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setImporting(true);
    setReport(null);
    setNotice(null);
    const res = await importSquadDelegatesAction(form);
    setImporting(false);
    if (!res.success) {
      setNotice({ tone: 'bad', text: res.error || 'The sheet could not be read.' });
      setReport(res.rejected?.length ? res : null);
      return;
    }
    setReport(res);
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  function onDelete(d: DelegateWithQr) {
    if (!confirm(`Remove ${d.full_name}? Their pass (${d.pass_no}) stops working.`)) return;
    startTransition(async () => {
      const res = await deleteSquadDelegateAction(d.id);
      setNotice(res.success ? { tone: 'ok', text: `${d.full_name} removed.` } : { tone: 'bad', text: res.error || 'Could not remove.' });
      if (res.success) router.refresh();
    });
  }

  return (
    <div className="squad-dashboard-root" style={{ padding: '1.5rem 1.25rem 3rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ color: '#b45309', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.1em' }}>CONTINGENT PORTAL · PASSES</div>
        <h1 style={{ margin: '0.2rem 0 0.35rem', fontSize: '1.6rem', fontWeight: 900, color: '#0f172a' }}>PED Passes</h1>
        <p style={{ margin: 0, color: '#475569', fontSize: '0.9rem', maxWidth: '72ch' }}>
          Each Physical Education Director coming with your squads gets a free pass with its own QR code. It is scanned at
          the food counters (breakfast, lunch, snacks and dinner) and, if you ask for accommodation, at the hostel.
          <strong> No fee and no check-in</strong> — the pass works from the moment it is made. Check the details below;
          they come from your registration.
        </p>
      </div>

      {blockReason && (
        <div style={{ marginBottom: '1.25rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '1rem 1.15rem' }}>
          <div style={{ fontWeight: 800, color: '#9a3412', fontSize: '0.92rem' }}>🔒 PED passes are closed for editing</div>
          <div style={{ color: '#7c2d12', fontSize: '0.85rem', marginTop: '0.25rem' }}>{blockReason}</div>
        </div>
      )}

      {notice && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.8rem 1rem',
            borderRadius: 10,
            fontSize: '0.88rem',
            fontWeight: 600,
            background: notice.tone === 'ok' ? '#ecfdf5' : '#fef2f2',
            color: notice.tone === 'ok' ? '#065f46' : '#991b1b',
            border: `1px solid ${notice.tone === 'ok' ? '#a7f3d0' : '#fecaca'}`,
          }}
        >
          {notice.text}
        </div>
      )}

      {report && <ImportReport report={report} />}

      <section style={{ ...CARD, padding: 0, overflow: 'hidden', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 850, color: '#0f172a' }}>{collegeName || collegeCode} — PEDs</h2>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>Shared by the Men&rsquo;s and Women&rsquo;s squads of the college.</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" style={BTN_GHOST} onClick={() => setAdding(true)} disabled={!canEdit}>
              ➕ Add PED
            </button>
            <Link href="/squad/faculty/passes" style={BTN_SECONDARY} target="_blank">
              🪪 Print passes ({delegates.length})
            </Link>
          </div>
        </div>

        {delegates.length === 0 ? (
          <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.4rem' }}>🎟️</div>
            <div style={{ fontWeight: 800, color: '#334155', marginTop: '0.35rem' }}>No PED pass yet</div>
            <div style={{ color: '#64748b', fontSize: '0.86rem', marginTop: '0.25rem' }}>
              The meet office makes them from your registration, or add your PED here.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="squad-roster-table">
              <thead>
                <tr>
                  <th>Pass</th>
                  <th>Name</th>
                  <th>In charge of</th>
                  <th>Mobile</th>
                  <th>Accommodation</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {delegates.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 800, color: '#0f172a' }}>{d.pass_no}</td>
                    <td>
                      <div style={{ fontWeight: 750, color: '#0f172a' }}>{d.full_name}</div>
                      <div style={{ fontSize: '0.75rem', color: d.accreditation_status === 'WITHDRAWN' ? '#b91c1c' : '#64748b' }}>
                        {d.accreditation_status === 'WITHDRAWN' ? 'Cancelled by the meet office' : d.email || ''}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#334155' }}>{SCOPE_LABEL[d.squad_scope]}</td>
                    <td style={{ fontSize: '0.82rem', color: '#334155' }}>{d.phone || '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: '#334155' }}>{d.accommodation_required ? 'Required' : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" style={BTN_TINY} onClick={() => setEditing(d)} disabled={!canEdit}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={{ ...BTN_TINY, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}
                        onClick={() => onDelete(d)}
                        disabled={!canEdit || pending}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={CARD}>
        <h2 style={{ margin: '0 0 0.35rem', fontSize: '0.98rem', fontWeight: 850, color: '#0f172a' }}>📤 Or upload the Excel sheet</h2>
        <p style={{ margin: '0 0 0.8rem', fontSize: '0.84rem', color: '#475569', lineHeight: 1.5 }}>
          Fill in sheet <strong>2. PEDs</strong> of the{' '}
          <a href="/api/delegate-template" download style={{ color: '#1d4ed8', fontWeight: 700 }}>
            template
          </a>{' '}
          (your college code{collegeCode ? ` ${collegeCode}` : ''} is already in every row) and upload it. The other sheets
          are filled by the meet office and are skipped. Uploading again updates the same people.
        </p>
        <form onSubmit={onUpload} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            disabled={!canEdit || importing}
            style={{ fontSize: '0.85rem' }}
          />
          <button type="submit" style={BTN_SECONDARY} disabled={!canEdit || importing}>
            {importing ? 'Reading the sheet…' : 'Upload'}
          </button>
        </form>
      </section>

      {(editing || adding) && (
        <PedForm
          delegate={editing}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
          onSaved={(text) => {
            setEditing(null);
            setAdding(false);
            setNotice({ tone: 'ok', text });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function ImportReport({ report }: { report: ImportResult }) {
  const rejected = report.rejected || [];
  return (
    <div style={{ marginBottom: '1.25rem', border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: '1rem 1.15rem' }}>
      <div style={{ fontWeight: 850, color: '#1e3a8a' }}>
        Sheet read — {report.added || 0} added, {report.updated || 0} updated
        {rejected.length ? `, ${rejected.length} not accepted` : ''}
      </div>
      {report.missingSheets?.length ? (
        <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: '0.3rem' }}>
          Not found in your file: {report.missingSheets.join(', ')}. Use the template as it is downloaded.
        </div>
      ) : null}
      {rejected.length > 0 && (
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', fontSize: '0.82rem', color: '#991b1b' }}>
          {rejected.map((r, i) => (
            <li key={i}>
              <strong>Row {r.excelRow}</strong> — {r.name}: {r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PedForm({ delegate, onClose, onSaved }: { delegate: DelegateWithQr | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (delegate) form.set('id', delegate.id);
    setSaving(true);
    setError(null);
    const res = delegate ? await updateSquadDelegateAction(form) : await addSquadDelegateAction(form);
    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Could not save.');
      return;
    }
    onSaved(`${form.get('fullName')} ${delegate ? 'updated' : 'added'}.`);
  }

  return (
    <div className="athlete-modal-overlay" onClick={onClose}>
      <div className="athlete-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.15rem', fontWeight: 850, color: '#0f172a' }}>
          {delegate ? 'Edit' : 'Add'} Physical Education Director
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#64748b' }}>The pass number is issued automatically.</p>

        {error && (
          <div style={{ marginBottom: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '0.85rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <input type="hidden" name="designation" value={PED_DESIGNATION} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <Field label="Full name *">
              <input name="fullName" defaultValue={delegate?.full_name || ''} required maxLength={80} style={INPUT} />
            </Field>
            <Field label="Mobile number">
              <input name="phone" defaultValue={delegate?.phone || ''} inputMode="numeric" placeholder="10 digits" style={INPUT} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" defaultValue={delegate?.email || ''} style={INPUT} />
            </Field>
            <Field label="In charge of">
              <select name="scope" defaultValue={delegate?.squad_scope || 'BOTH'} style={INPUT}>
                <option value="BOTH">Men&rsquo;s &amp; Women&rsquo;s squads</option>
                <option value="MEN">Men&rsquo;s squad</option>
                <option value="WOMEN">Women&rsquo;s squad</option>
              </select>
            </Field>
            <Field label="Gender">
              <select name="gender" defaultValue={delegate?.gender || ''} style={INPUT}>
                <option value="">—</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Blood group">
              <select name="bloodGroup" defaultValue={delegate?.blood_group || ''} style={INPUT}>
                <option value="">—</option>
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Meals">
              <select name="meals" defaultValue={delegate?.meals_included === false ? 'no' : 'yes'} style={INPUT}>
                <option value="yes">Yes</option>
                <option value="no">No meals</option>
              </select>
            </Field>
            <Field label="Accommodation">
              <select name="accommodation" defaultValue={delegate?.accommodation_required ? 'yes' : 'no'} style={INPUT}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.1rem' }}>
            <button type="button" onClick={onClose} style={BTN_GHOST}>
              Cancel
            </button>
            <button type="submit" style={BTN_PRIMARY} disabled={saving}>
              {saving ? 'Saving…' : delegate ? 'Save changes' : 'Add & issue pass'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginTop: '0.35rem' }}>
      <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 750, color: '#475569', marginBottom: '0.2rem' }}>{label}</span>
      {children}
    </label>
  );
}

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '1.1rem 1.25rem' };
const BTN_PRIMARY: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.55rem 1rem',
  borderRadius: 9,
  border: '1px solid #6d28d9',
  background: '#6d28d9',
  color: '#fff',
  fontWeight: 750,
  fontSize: '0.86rem',
  cursor: 'pointer',
};
const BTN_SECONDARY: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: 9,
  border: '1px solid #ddd6fe',
  background: '#f5f3ff',
  color: '#5b21b6',
  fontWeight: 750,
  fontSize: '0.84rem',
  textDecoration: 'none',
  cursor: 'pointer',
};
const BTN_GHOST: React.CSSProperties = {
  padding: '0.45rem 0.8rem',
  borderRadius: 9,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  fontSize: '0.82rem',
  cursor: 'pointer',
};
const BTN_TINY: React.CSSProperties = {
  marginLeft: '0.35rem',
  padding: '0.3rem 0.6rem',
  borderRadius: 7,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  fontSize: '0.76rem',
  cursor: 'pointer',
};
const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: '0.88rem',
  color: '#0f172a',
  background: '#fff',
};
