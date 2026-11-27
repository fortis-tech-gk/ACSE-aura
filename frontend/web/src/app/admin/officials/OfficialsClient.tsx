'use client';

/**
 * Meet office → Faculty & Officials.
 *
 * The same workbook the colleges fill, but here all three sheets are read: the meet office
 * uploads its own referees, technical officials and volunteers (sheet 3), and can fix or
 * add a college's faculty row for a PED who cannot. Passes print from here too.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUrlFilters } from '../useUrlFilters';
import {
  BLOOD_GROUPS,
  CATEGORY_LABEL,
  FACULTY_DESIGNATIONS,
  OFFICIAL_ROLES,
  PED_DESIGNATION,
  SCOPE_LABEL,
  type DelegateCategory,
} from '@/lib/delegates';
import {
  deleteAdminDelegateAction,
  importAdminDelegatesAction,
  saveAdminDelegateAction,
  setDelegateStatusAction,
  type AdminDelegateFilters,
  type DelegateWithQr,
  type ImportResult,
} from '@/app/actions/delegates';

interface Props {
  delegates: DelegateWithQr[];
  filters: AdminDelegateFilters;
  colleges: { code: string; name: string }[];
}

const CAT_BADGE: Record<DelegateCategory, { bg: string; fg: string; label: string }> = {
  PED: { bg: '#ede9fe', fg: '#5b21b6', label: 'PED' },
  FACULTY: { bg: '#dbeafe', fg: '#1e40af', label: 'Faculty' },
  OFFICIAL: { bg: '#fef3c7', fg: '#92400e', label: 'Official' },
};

export default function OfficialsClient({ delegates, filters, colleges }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { set, pending: navPending } = useUrlFilters();
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [editing, setEditing] = useState<DelegateWithQr | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState(filters.q || '');
  const lastSent = useRef(filters.q || '');
  useEffect(() => {
    const q = search.trim();
    if (q === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = q;
      set({ q });
    }, 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    all: delegates.length,
    meals: delegates.filter((d) => d.meals_included && d.accreditation_status !== 'WITHDRAWN').length,
    stay: delegates.filter((d) => d.accommodation_required).length,
  };

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setImporting(true);
    setReport(null);
    setNotice(null);
    const res = await importAdminDelegatesAction(form);
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

  function act(label: string, run: () => Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await run();
      setNotice(res.success ? { tone: 'ok', text: label } : { tone: 'bad', text: res.error || 'That did not work.' });
      if (res.success) router.refresh();
    });
  }

  return (
    <div>
      <div className="admin-page-header no-print">
        <div className="admin-title-group">
          <h2>Faculty, PEDs &amp; Meet Officials</h2>
          <p>
            Accreditation passes for everyone who is not an athlete. Colleges send their faculty and PEDs from the
            Contingent Portal; the meet office fills in sheet&nbsp;3 of the same workbook for referees, technical
            officials, jury, volunteers, medical, media and guests. Every pass carries a QR the gate and food counters
            scan, and a pass number from 90001.
          </p>
        </div>
        <div className="admin-actions-group" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <a href="/api/delegate-template" className="btn-admin" style={BTN_GHOST} download>
            ⬇️ Blank template
          </a>
          <button type="button" className="btn-admin" style={BTN_GHOST} onClick={() => setAdding(true)}>
            ➕ Add one person
          </button>
          <Link
            href={`/admin/officials/passes${params.toString() ? `?${params.toString()}` : ''}`}
            className="btn-admin btn-admin-primary"
            style={BTN_PRIMARY}
            target="_blank"
          >
            🪪 Print {delegates.length} passes
          </Link>
        </div>
      </div>

      {/* Upload */}
      <section className="no-print" style={{ ...CARD, marginBottom: '1rem' }}>
        <form onSubmit={onUpload} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
          <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>📤 Upload a filled workbook</strong>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            disabled={importing}
            style={{ fontSize: '0.85rem' }}
          />
          <button type="submit" style={BTN_PRIMARY} disabled={importing}>
            {importing ? 'Reading…' : 'Import all three sheets'}
          </button>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Faculty / PED rows must carry a College Code. Re-uploading updates the same people.
          </span>
        </form>
      </section>

      {notice && (
        <div
          className="no-print"
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

      {report && (
        <div className="no-print" style={{ ...CARD, marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <div style={{ fontWeight: 850, color: '#1e3a8a' }}>
            Sheet read — {report.added || 0} added, {report.updated || 0} updated
            {report.rejected?.length ? `, ${report.rejected.length} not accepted` : ''}
          </div>
          {report.missingSheets?.length ? (
            <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: '0.3rem' }}>
              Not found in the file: {report.missingSheets.join(', ')}.
            </div>
          ) : null}
          {report.rejected?.length ? (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', fontSize: '0.82rem', color: '#991b1b', maxHeight: 240, overflowY: 'auto' }}>
              {report.rejected.map((r, i) => (
                <li key={i}>
                  <strong>{r.sheet} row {r.excelRow}</strong> — {r.name}: {r.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar no-print">
        <div className="filter-inputs">
          <input
            type="text"
            placeholder="🔍 Name, role, pass no, college…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-control"
            style={{ minWidth: 240 }}
          />
          <select value={filters.category || 'ALL'} onChange={(e) => set({ category: e.target.value })} className="filter-control">
            <option value="ALL">All categories</option>
            <option value="PED">PEDs</option>
            <option value="FACULTY">College faculty</option>
            <option value="OFFICIAL">Meet officials &amp; volunteers</option>
          </select>
          <select value={filters.college || ''} onChange={(e) => set({ college: e.target.value })} className="filter-control">
            <option value="">All colleges</option>
            {colleges.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          <strong>{counts.all}</strong> passes · <strong>{counts.meals}</strong> with meals · <strong>{counts.stay}</strong> want a bed
        </div>
      </div>

      {/* Table */}
      {navPending ? (
        <div style={{ ...CARD, textAlign: 'center', color: '#2563eb', fontWeight: 600, padding: '2.5rem 1rem' }}>Loading…</div>
      ) : delegates.length === 0 ? (
        <div style={{ ...CARD, textAlign: 'center', color: '#94a3b8', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2.4rem' }}>🎟️</div>
          <div style={{ fontWeight: 700, color: '#475569', marginTop: '0.3rem' }}>Nobody matches these filters</div>
          <div style={{ fontSize: '0.84rem', marginTop: '0.2rem' }}>
            Upload the workbook above, or add one person by hand.
          </div>
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                <Th>Pass</Th>
                <Th>Name</Th>
                <Th>Category / role</Th>
                <Th>College / body</Th>
                <Th>Mobile</Th>
                <Th>Meals</Th>
                <Th>Stay</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((d) => {
                const badge = CAT_BADGE[d.category];
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <Td><strong>{d.pass_no}</strong></Td>
                    <Td>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{d.full_name}</div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{d.department || d.email || '—'}</div>
                    </Td>
                    <Td>
                      <span style={{ display: 'inline-block', padding: '0.12rem 0.45rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 800, background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '0.15rem' }}>{d.designation}</div>
                    </Td>
                    <Td>
                      <div style={{ color: '#0f172a' }}>{d.colleges?.name || d.organisation || 'Meet organising committee'}</div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {d.colleges?.code ? `${d.colleges.code} · ${SCOPE_LABEL[d.squad_scope]}` : 'Host side'}
                      </div>
                    </Td>
                    <Td>{d.phone || '—'}</Td>
                    <Td>{d.meals_included ? '✓' : '—'}</Td>
                    <Td>{d.accommodation_required ? '✓' : '—'}</Td>
                    <Td>
                      <StatusPill status={d.accreditation_status} />
                    </Td>
                    <Td align="right">
                      <button type="button" style={BTN_TINY} onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      {d.accreditation_status === 'WITHDRAWN' ? (
                        <button
                          type="button"
                          style={BTN_TINY}
                          disabled={pending}
                          onClick={() => act(`${d.full_name}'s pass is active again.`, () => setDelegateStatusAction(d.id, 'REGISTERED'))}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{ ...BTN_TINY, color: '#b45309', borderColor: '#fed7aa', background: '#fff7ed' }}
                          disabled={pending}
                          onClick={() => act(`${d.full_name}'s pass is cancelled.`, () => setDelegateStatusAction(d.id, 'WITHDRAWN'))}
                        >
                          Cancel pass
                        </button>
                      )}
                      <button
                        type="button"
                        style={{ ...BTN_TINY, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Delete ${d.full_name} and their meal history? Cancelling the pass is usually enough.`)) return;
                          act(`${d.full_name} deleted.`, () => deleteAdminDelegateAction(d.id));
                        }}
                      >
                        Delete
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(editing || adding) && (
        <AdminDelegateForm
          delegate={editing}
          colleges={colleges}
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

function AdminDelegateForm({
  delegate,
  colleges,
  onClose,
  onSaved,
}: {
  delegate: DelegateWithQr | null;
  colleges: { code: string; name: string }[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [category, setCategory] = useState<DelegateCategory>(delegate?.category || 'OFFICIAL');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isOfficial = category === 'OFFICIAL';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set('category', category);
    if (delegate) form.set('id', delegate.id);
    setSaving(true);
    setError(null);
    const res = await saveAdminDelegateAction(form);
    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Could not save.');
      return;
    }
    onSaved(`${form.get('fullName')} ${delegate ? 'updated' : 'added'}.`);
  }

  return (
    <div className="athlete-modal-overlay" onClick={onClose}>
      <div className="athlete-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.15rem', fontWeight: 850, color: '#0f172a' }}>
          {delegate ? `Edit pass ${delegate.pass_no}` : 'Add a pass'}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.75rem' }}>
            <Field label="Category *">
              <select value={category} onChange={(e) => setCategory(e.target.value as DelegateCategory)} style={INPUT}>
                <option value="OFFICIAL">Meet official / volunteer</option>
                <option value="FACULTY">College faculty</option>
                <option value="PED">Physical Education Director</option>
              </select>
            </Field>

            {!isOfficial && (
              <Field label="College *">
                <select name="collegeCode" defaultValue={delegate?.colleges?.code || ''} required style={INPUT}>
                  <option value="">— choose —</option>
                  {colleges.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Full name *">
              <input name="fullName" defaultValue={delegate?.full_name || ''} required maxLength={80} style={INPUT} />
            </Field>

            <Field label={isOfficial ? 'Role *' : 'Designation *'}>
              <select
                name="designation"
                defaultValue={delegate?.designation || (isOfficial ? 'Referee' : category === 'PED' ? PED_DESIGNATION : 'Team Manager')}
                required
                style={INPUT}
              >
                {(isOfficial ? OFFICIAL_ROLES : category === 'PED' ? [PED_DESIGNATION, ...FACULTY_DESIGNATIONS] : FACULTY_DESIGNATIONS).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            {isOfficial ? (
              <Field label="Organisation / deputed by">
                <input name="organisation" defaultValue={delegate?.organisation || ''} maxLength={80} style={INPUT} />
              </Field>
            ) : (
              <Field label="Department">
                <input name="department" defaultValue={delegate?.department || ''} maxLength={60} style={INPUT} />
              </Field>
            )}

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

            {!isOfficial && (
              <Field label="Contingent">
                <select name="scope" defaultValue={delegate?.squad_scope || 'BOTH'} style={INPUT}>
                  <option value="BOTH">Whole contingent</option>
                  <option value="MEN">Men&rsquo;s squad</option>
                  <option value="WOMEN">Women&rsquo;s squad</option>
                </select>
              </Field>
            )}

            <Field label="Meals">
              <select name="meals" defaultValue={delegate?.meals_included === false ? 'no' : 'yes'} style={INPUT}>
                <option value="yes">Meal coupon on the pass</option>
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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    ACCREDITED: { bg: '#ecfdf5', fg: '#047857', text: 'Active' },
    REGISTERED: { bg: '#ecfdf5', fg: '#047857', text: 'Active' },
    WITHDRAWN: { bg: '#fef2f2', fg: '#b91c1c', text: 'Cancelled' },
  };
  const s = map[status] || map.REGISTERED;
  return (
    <span style={{ display: 'inline-block', padding: '0.18rem 0.55rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 800, background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th style={{ padding: '0.7rem 0.9rem', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: align || 'left', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <td style={{ padding: '0.65rem 0.9rem', textAlign: align || 'left', whiteSpace: align ? 'nowrap' : undefined, color: '#334155' }}>{children}</td>;
}

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 12, padding: '1rem 1.1rem' };
const BTN_PRIMARY: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.95rem',
  borderRadius: 9,
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#fff',
  fontWeight: 750,
  fontSize: '0.85rem',
  textDecoration: 'none',
  cursor: 'pointer',
};
const BTN_GHOST: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.45rem 0.85rem',
  borderRadius: 9,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  fontSize: '0.83rem',
  textDecoration: 'none',
  cursor: 'pointer',
};
const BTN_TINY: React.CSSProperties = {
  marginLeft: '0.3rem',
  padding: '0.28rem 0.55rem',
  borderRadius: 7,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  fontSize: '0.74rem',
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
