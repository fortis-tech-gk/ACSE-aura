'use client';

/**
 * Contingent portal → Faculty & Officials.
 *
 * Three things on one page: download the Excel workbook (pre-filled with this college's
 * code and PEDs), upload the filled copy, and keep the resulting list — each person gets
 * a numbered pass with a QR that works at the gate and the food counters.
 * Adding one person by hand is there too, for a college with only a coach or two.
 */

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BLOOD_GROUPS,
  CATEGORY_LABEL,
  FACULTY_DESIGNATIONS,
  PED_DESIGNATION,
  SCOPE_LABEL,
  type DelegateCategory,
} from '@/lib/delegates';
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

const CAT_BADGE: Record<DelegateCategory, { bg: string; fg: string; label: string }> = {
  PED: { bg: '#ede9fe', fg: '#5b21b6', label: 'PED' },
  FACULTY: { bg: '#dbeafe', fg: '#1e40af', label: 'Faculty' },
  OFFICIAL: { bg: '#fef3c7', fg: '#92400e', label: 'Official' },
};

export default function FacultyManager({ delegates, canEdit, blockReason, collegeName, collegeCode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [editing, setEditing] = useState<DelegateWithQr | null>(null);
  const [adding, setAdding] = useState<DelegateCategory | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const peds = delegates.filter((d) => d.category === 'PED');
  const faculty = delegates.filter((d) => d.category === 'FACULTY');
  const withMeals = delegates.filter((d) => d.meals_included && d.accreditation_status !== 'WITHDRAWN').length;
  const needStay = delegates.filter((d) => d.accommodation_required).length;

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
    if (!confirm(`Remove ${d.full_name} from the list? Their pass (${d.pass_no}) stops working.`)) return;
    startTransition(async () => {
      const res = await deleteSquadDelegateAction(d.id);
      setNotice(res.success ? { tone: 'ok', text: `${d.full_name} removed.` } : { tone: 'bad', text: res.error || 'Could not remove.' });
      if (res.success) router.refresh();
    });
  }

  return (
    <div className="squad-dashboard-root" style={{ padding: '1.5rem 1.25rem 3rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div className="squad-micro-eyebrow" style={{ color: '#b45309', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.1em' }}>
          CONTINGENT PORTAL · ACCREDITATION
        </div>
        <h1 style={{ margin: '0.2rem 0 0.35rem', fontSize: '1.6rem', fontWeight: 900, color: '#0f172a' }}>
          Faculty, PEDs &amp; Officials
        </h1>
        <p style={{ margin: 0, color: '#475569', fontSize: '0.9rem', maxWidth: '70ch' }}>
          Everyone travelling with the contingent who is not an athlete needs a pass of their own — the team manager,
          coaches, escorting faculty and the Physical Education Director. Fill in the Excel sheet below (or add them one
          by one) and print a 4×6 inch pass with a QR code that the gate and the food counters scan.
          <strong> Faculty passes are free</strong> — nothing is added to the college fee.
        </p>
      </div>

      {blockReason && (
        <div className="squad-lock-notice" style={{ marginBottom: '1.25rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '1rem 1.15rem' }}>
          <div style={{ fontWeight: 800, color: '#9a3412', fontSize: '0.92rem' }}>🔒 The faculty list is closed for editing</div>
          <div style={{ color: '#7c2d12', fontSize: '0.85rem', marginTop: '0.25rem' }}>{blockReason}</div>
        </div>
      )}

      {/* Counters */}
      <div className="squad-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <Kpi label="Passes issued" value={delegates.length} hint={`${peds.length} PED · ${faculty.length} faculty`} tone="#1e40af" />
        <Kpi label="With meal coupon" value={withMeals} hint="Breakfast · lunch · snacks · dinner" tone="#047857" />
        <Kpi label="Asked for a bed" value={needStay} hint="Confirmed by the meet office" tone="#b45309" />
      </div>

      {/* Step 1 / Step 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <section className="squad-op-card" style={CARD}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b' }}>STEP 1</div>
          <h2 style={CARD_TITLE}>📥 Download the Excel sheet</h2>
          <p style={CARD_TEXT}>
            One workbook with three sheets — <strong>1. Faculty</strong>, <strong>2. PEDs</strong> and
            <strong> 3. Officials &amp; Volunteers</strong> (that third one is the meet office&rsquo;s; anything you type
            there is ignored). Your college code{collegeCode ? ` (${collegeCode})` : ''} is already filled into every row,
            and the PED rows carry what we have on record — correct them if anything changed.
          </p>
          <a href="/api/delegate-template" className="squad-cta-primary" style={BTN_PRIMARY} download>
            ⬇️ Download template (.xlsx)
          </a>
        </section>

        <section className="squad-op-card" style={CARD}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b' }}>STEP 2</div>
          <h2 style={CARD_TITLE}>📤 Upload the filled sheet</h2>
          <p style={CARD_TEXT}>
            Save it as <strong>.xlsx</strong> and upload it here. Uploading a corrected copy later updates the same people
            (matched on the name) instead of adding them twice. Rows we cannot read are listed with the reason.
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
            <button type="submit" className="squad-cta-secondary" style={BTN_SECONDARY} disabled={!canEdit || importing}>
              {importing ? 'Reading the sheet…' : 'Upload & create passes'}
            </button>
          </form>
        </section>
      </div>

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

      {/* The list */}
      <section className="squad-roster-card" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div
          className="squad-roster-header"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 850, color: '#0f172a' }}>
              {collegeName || collegeCode} — pass list
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>
              Shared by the Men&rsquo;s and Women&rsquo;s squads of the college.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" style={BTN_GHOST} onClick={() => setAdding('FACULTY')} disabled={!canEdit}>
              ➕ Add faculty
            </button>
            <button type="button" style={BTN_GHOST} onClick={() => setAdding('PED')} disabled={!canEdit}>
              ➕ Add PED
            </button>
            <Link href="/squad/faculty/passes" style={BTN_SECONDARY} target="_blank">
              🪪 Print passes ({delegates.length})
            </Link>
          </div>
        </div>

        {delegates.length === 0 ? (
          <div className="squad-empty-roster" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
            <div className="squad-empty-icon" style={{ fontSize: '2.4rem' }}>🎟️</div>
            <div className="squad-empty-title" style={{ fontWeight: 800, color: '#334155', marginTop: '0.35rem' }}>
              No faculty or PED passes yet
            </div>
            <div className="squad-empty-desc" style={{ color: '#64748b', fontSize: '0.86rem', marginTop: '0.25rem' }}>
              Download the sheet above, fill in who is coming, and upload it — or add them one at a time.
            </div>
          </div>
        ) : (
          <div className="squad-table-container" style={{ overflowX: 'auto' }}>
            <table className="squad-roster-table">
              <thead>
                <tr>
                  <th>Pass</th>
                  <th>Name</th>
                  <th>Capacity</th>
                  <th>Contingent</th>
                  <th>Mobile</th>
                  <th>Meals</th>
                  <th>Stay</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {delegates.map((d) => {
                  const badge = CAT_BADGE[d.category];
                  return (
                    <tr key={d.id}>
                      <td>
                        <span className="squad-bib-badge" style={{ fontWeight: 800, color: '#0f172a' }}>{d.pass_no}</span>
                      </td>
                      <td>
                        <div className="squad-athlete-name" style={{ fontWeight: 750, color: '#0f172a' }}>{d.full_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {d.department || d.email || '—'}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: badge.bg, color: badge.fg }}>
                          {badge.label}
                        </span>
                        <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '0.2rem' }}>{d.designation}</div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#334155' }}>{SCOPE_LABEL[d.squad_scope]}</td>
                      <td style={{ fontSize: '0.82rem', color: '#334155' }}>{d.phone || '—'}</td>
                      <td>{d.meals_included ? <Tick /> : <Cross />}</td>
                      <td>{d.accommodation_required ? <Tick /> : <Cross />}</td>
                      <td>
                        <StatusPill status={d.accreditation_status} />
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#64748b', maxWidth: '80ch' }}>
        A pass starts working at the food counters once the college fee is verified <em>and</em> the college has checked in
        at the accreditation desk. Each pass is good for one breakfast, lunch, snacks and dinner per day.
      </p>

      {(editing || adding) && (
        <DelegateForm
          delegate={editing}
          category={editing?.category || adding || 'FACULTY'}
          onClose={() => {
            setEditing(null);
            setAdding(null);
          }}
          onSaved={(text) => {
            setEditing(null);
            setAdding(null);
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
      {report.officialsIgnored && (
        <div style={{ fontSize: '0.8rem', color: '#1e40af', marginTop: '0.3rem' }}>
          Sheet 3 (&quot;Officials &amp; Volunteers&quot;) is filled in by the meet office, so it was skipped.
        </div>
      )}
      {report.missingSheets?.length ? (
        <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: '0.3rem' }}>
          Not found in your file: {report.missingSheets.join(', ')}. Use the template as it is downloaded — do not rename or delete its sheets.
        </div>
      ) : null}
      {rejected.length > 0 && (
        <div style={{ marginTop: '0.65rem', maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '0.3rem 0.5rem' }}>Sheet</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Row</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Name</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Why it was not accepted</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? '#ffffff' : '#f8fafc' }}>
                  <td style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }}>{r.sheet}</td>
                  <td style={{ padding: '0.3rem 0.5rem' }}>{r.excelRow}</td>
                  <td style={{ padding: '0.3rem 0.5rem' }}>{r.name}</td>
                  <td style={{ padding: '0.3rem 0.5rem', color: '#991b1b' }}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DelegateForm({
  delegate,
  category,
  onClose,
  onSaved,
}: {
  delegate: DelegateWithQr | null;
  category: DelegateCategory;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isPed = category === 'PED';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set('category', category);
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
      <div className="athlete-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.15rem', fontWeight: 850, color: '#0f172a' }}>
          {delegate ? 'Edit' : 'Add'} {isPed ? 'Physical Education Director' : 'faculty member'}
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#64748b' }}>
          {CATEGORY_LABEL[category]} · the pass number is issued automatically.
        </p>

        {error && (
          <div style={{ marginBottom: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '0.85rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="athlete-modal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.75rem' }}>
            <Field label="Full name *">
              <input name="fullName" defaultValue={delegate?.full_name || ''} required maxLength={80} style={INPUT} />
            </Field>

            <Field label={isPed ? 'Designation' : 'Designation *'}>
              {isPed ? (
                <input name="designation" defaultValue={delegate?.designation || PED_DESIGNATION} style={INPUT} />
              ) : (
                <select name="designation" defaultValue={delegate?.designation || 'Team Manager'} required style={INPUT}>
                  {FACULTY_DESIGNATIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Department">
              <input name="department" defaultValue={delegate?.department || ''} maxLength={60} style={INPUT} />
            </Field>

            <Field label="Mobile number">
              <input name="phone" defaultValue={delegate?.phone || ''} inputMode="numeric" placeholder="10 digits" style={INPUT} />
            </Field>

            <Field label="Email">
              <input name="email" type="email" defaultValue={delegate?.email || ''} style={INPUT} />
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

            <Field label={isPed ? 'In charge of' : 'Travels with'}>
              <select name="scope" defaultValue={delegate?.squad_scope || 'BOTH'} style={INPUT}>
                <option value="BOTH">Whole contingent</option>
                <option value="MEN">Men&rsquo;s squad</option>
                <option value="WOMEN">Women&rsquo;s squad</option>
              </select>
            </Field>

            <Field label="Meals">
              <select name="meals" defaultValue={delegate?.meals_included === false ? 'no' : 'yes'} style={INPUT}>
                <option value="yes">Meal coupon on the pass</option>
                <option value="no">No meals</option>
              </select>
            </Field>

            <Field label="Accommodation">
              <select name="accommodation" defaultValue={delegate?.accommodation_required ? 'yes' : 'no'} style={INPUT}>
                <option value="no">Not required</option>
                <option value="yes">Required (meet office confirms)</option>
              </select>
            </Field>
          </div>

          <Field label="Remarks">
            <input name="remarks" defaultValue={delegate?.remarks || ''} maxLength={200} style={INPUT} />
          </Field>

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

function Kpi({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) {
  return (
    <div className="squad-kpi-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '0.9rem 1rem' }}>
      <div className="squad-kpi-label" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: '#64748b', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div className="squad-kpi-number" style={{ fontSize: '1.7rem', fontWeight: 900, color: tone, lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="squad-kpi-sub" style={{ fontSize: '0.75rem', color: '#64748b' }}>{hint}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    ACCREDITED: { bg: '#ecfdf5', fg: '#047857', text: 'Accredited' },
    REGISTERED: { bg: '#f1f5f9', fg: '#475569', text: 'Awaiting check-in' },
    WITHDRAWN: { bg: '#fef2f2', fg: '#b91c1c', text: 'Cancelled' },
  };
  const s = map[status] || map.REGISTERED;
  return (
    <span style={{ display: 'inline-block', padding: '0.18rem 0.55rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 800, background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

const Tick = () => <span style={{ color: '#047857', fontWeight: 800 }}>✓</span>;
const Cross = () => <span style={{ color: '#94a3b8', fontWeight: 800 }}>—</span>;

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: '1.1rem 1.25rem',
};
const CARD_TITLE: React.CSSProperties = { margin: '0.25rem 0 0.4rem', fontSize: '1.05rem', fontWeight: 850, color: '#0f172a' };
const CARD_TEXT: React.CSSProperties = { margin: '0 0 0.85rem', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 };
const BTN_PRIMARY: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.55rem 1rem',
  borderRadius: 9,
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#fff',
  fontWeight: 750,
  fontSize: '0.86rem',
  textDecoration: 'none',
  cursor: 'pointer',
};
const BTN_SECONDARY: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: 9,
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  color: '#1e40af',
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
