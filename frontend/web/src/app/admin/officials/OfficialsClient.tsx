'use client';

/**
 * Meet office → Passes (ACS faculty · PED · volunteer · technical official).
 *
 * Four ways in: upload the workbook (all three sheets), make a numbered batch of BLANK
 * ACS-faculty / volunteer passes that are filled in by hand, make PED passes from this year's
 * registration, or add one person. Every pass is free, needs no check-in, and its QR is used
 * only at food and (when asked for) the hostel. Passes print from here, one per 4×6 page.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUrlFilters } from '../useUrlFilters';
import {
  BLOOD_GROUPS,
  BLANK_PASS_CATEGORIES,
  CATEGORY_LABEL,
  FACULTY_DESIGNATIONS,
  OFFICIAL_ROLES,
  PED_DESIGNATION,
  SCOPE_LABEL,
  passDisplayName,
  type DelegateCategory,
} from '@/lib/delegates';
import {
  createPedPassesFromRegistrationAction,
  deleteAdminDelegateAction,
  generateBlankPassesAction,
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

/** Same colours as the type bar on the printed pass */
const CAT_BADGE: Record<DelegateCategory, { bg: string; fg: string; label: string }> = {
  FACULTY: { bg: '#dbeafe', fg: '#1d4ed8', label: 'ACS Faculty' },
  PED: { bg: '#ede9fe', fg: '#6d28d9', label: 'PED' },
  VOLUNTEER: { bg: '#dcfce7', fg: '#15803d', label: 'Volunteer' },
  OFFICIAL: { bg: '#fee2e2', fg: '#b91c1c', label: 'Official' },
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

  const counts = (Object.keys(CAT_BADGE) as DelegateCategory[]).map((c) => ({
    c,
    n: delegates.filter((d) => d.category === c).length,
  }));
  const blanks = delegates.filter((d) => !d.full_name).length;

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

  function act(label: string, run: () => Promise<{ success: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await run();
      setNotice(res.success ? { tone: 'ok', text: res.message || label } : { tone: 'bad', text: res.error || 'That did not work.' });
      if (res.success) router.refresh();
    });
  }

  function onBlankBatch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    act('Blank passes made.', () => generateBlankPassesAction(form));
  }

  return (
    <div>
      <div className="admin-page-header no-print">
        <div className="admin-title-group">
          <h2>Passes — ACS Faculty, PEDs, Volunteers &amp; Officials</h2>
          <p>
            Free passes for everyone who is not an athlete. No fee and no check-in: a pass works from the moment it is
            made until you cancel it. Its QR is scanned only at the food counters and, if accommodation was asked for, at
            the hostel. Pass numbers start at 90001 and can be typed at a counter like a bib.
          </p>
        </div>
        <div className="admin-actions-group" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <a href="/api/delegate-template" className="btn-admin" style={BTN_GHOST} download>
            ⬇️ Blank Excel template
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

      {/* Ways in */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
        <section style={CARD}>
          <h3 style={H3}>🎟️ Blank numbered passes</h3>
          <p style={P}>ACS faculty and volunteer passes with a QR and number but no name — written in by hand.</p>
          <form onSubmit={onBlankBatch} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <select name="category" defaultValue="VOLUNTEER" style={{ ...INPUT, width: 'auto' }}>
              {BLANK_PASS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input name="count" type="number" min={1} max={500} defaultValue={50} required style={{ ...INPUT, width: 90 }} aria-label="How many" />
            <select name="accommodation" defaultValue="no" style={{ ...INPUT, width: 'auto' }} aria-label="Accommodation">
              <option value="no">No stay</option>
              <option value="yes">With stay</option>
            </select>
            <button type="submit" style={BTN_PRIMARY} disabled={pending}>
              Make passes
            </button>
          </form>
        </section>

        <section style={CARD}>
          <h3 style={H3}>🏫 PED passes from registration</h3>
          <p style={P}>
            One pass for each PED named by the colleges when they registered (same person on both squads = one pass).
            Anyone who already has a PED pass is skipped, so it is safe to run again.
          </p>
          <button
            type="button"
            style={BTN_PRIMARY}
            disabled={pending}
            onClick={() => act('PED passes made.', () => createPedPassesFromRegistrationAction())}
          >
            Make PED passes
          </button>
        </section>

        <section style={CARD}>
          <h3 style={H3}>📤 Upload the filled workbook</h3>
          <p style={P}>
            Sheet 1 ACS faculty, sheet 2 PEDs (with college code), sheet 3 officials — role &quot;Volunteer&quot; makes a
            volunteer pass. Re-uploading updates the same people.
          </p>
          <form onSubmit={onUpload} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              disabled={importing}
              style={{ fontSize: '0.82rem', maxWidth: 220 }}
            />
            <button type="submit" style={BTN_PRIMARY} disabled={importing}>
              {importing ? 'Reading…' : 'Import'}
            </button>
          </form>
        </section>
      </div>

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
                  <strong>
                    {r.sheet} row {r.excelRow}
                  </strong>{' '}
                  — {r.name}: {r.reason}
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
            <option value="ALL">All pass types</option>
            {(Object.keys(CAT_BADGE) as DelegateCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select value={filters.names || ''} onChange={(e) => set({ names: e.target.value })} className="filter-control">
            <option value="">Named and blank</option>
            <option value="named">Named only</option>
            <option value="blank">Blank only</option>
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
        <div style={{ fontSize: '0.84rem', color: '#64748b', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {counts.map(({ c, n }) => (
            <span key={c}>
              <strong style={{ color: CAT_BADGE[c].fg }}>{n}</strong> {CAT_BADGE[c].label}
            </span>
          ))}
          <span>· {blanks} blank</span>
        </div>
      </div>

      {/* Table */}
      {navPending ? (
        <div style={{ ...CARD, textAlign: 'center', color: '#2563eb', fontWeight: 600, padding: '2.5rem 1rem' }}>Loading…</div>
      ) : delegates.length === 0 ? (
        <div style={{ ...CARD, textAlign: 'center', color: '#94a3b8', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2.4rem' }}>🎟️</div>
          <div style={{ fontWeight: 700, color: '#475569', marginTop: '0.3rem' }}>No passes match these filters</div>
          <div style={{ fontSize: '0.84rem', marginTop: '0.2rem' }}>Make a blank batch, make PED passes, upload the workbook, or add one person.</div>
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                <Th>Pass</Th>
                <Th>Name</Th>
                <Th>Type / role</Th>
                <Th>College / body</Th>
                <Th>Mobile</Th>
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
                    <Td>
                      <strong>{d.pass_no}</strong>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 700, color: d.full_name ? '#0f172a' : '#94a3b8', fontStyle: d.full_name ? 'normal' : 'italic' }}>
                        {d.full_name || 'Blank — name written by hand'}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{d.department || d.email || ''}</div>
                    </Td>
                    <Td>
                      <span style={{ display: 'inline-block', padding: '0.12rem 0.45rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 800, background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                      {d.category === 'OFFICIAL' && <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '0.15rem' }}>{d.designation}</div>}
                    </Td>
                    <Td>
                      {d.category === 'PED' ? (
                        <>
                          <div style={{ color: '#0f172a' }}>{d.colleges?.name}</div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                            {d.colleges?.code} · {SCOPE_LABEL[d.squad_scope]}
                          </div>
                        </>
                      ) : d.category === 'FACULTY' ? (
                        'Dr. ACS (host)'
                      ) : (
                        d.organisation || '—'
                      )}
                    </Td>
                    <Td>{d.phone || '—'}</Td>
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
                          onClick={() => act(`Pass ${d.pass_no} is active again.`, () => setDelegateStatusAction(d.id, 'ACCREDITED'))}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{ ...BTN_TINY, color: '#b45309', borderColor: '#fed7aa', background: '#fff7ed' }}
                          disabled={pending}
                          onClick={() => act(`Pass ${d.pass_no} is cancelled.`, () => setDelegateStatusAction(d.id, 'WITHDRAWN'))}
                        >
                          Cancel pass
                        </button>
                      )}
                      <button
                        type="button"
                        style={{ ...BTN_TINY, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Delete ${passDisplayName(d)} and its meal history? Cancelling the pass is usually enough.`)) return;
                          act(`Pass ${d.pass_no} deleted.`, () => deleteAdminDelegateAction(d.id));
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
  const nameOptional = BLANK_PASS_CATEGORIES.includes(category);

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
    onSaved(`${form.get('fullName') || 'Pass'} ${delegate ? 'updated' : 'added'}.`);
  }

  return (
    <div className="athlete-modal-overlay" onClick={onClose}>
      <div className="athlete-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.15rem', fontWeight: 850, color: '#0f172a' }}>
          {delegate ? `Edit pass ${delegate.pass_no}` : 'Add a pass'}
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#64748b' }}>
          {CATEGORY_LABEL[category]} · {nameOptional ? 'leave the name empty for a blank pass written by hand' : 'the pass number is issued automatically'}.
        </p>

        {error && (
          <div style={{ marginBottom: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '0.85rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.75rem' }}>
            <Field label="Pass type *">
              <select value={category} onChange={(e) => setCategory(e.target.value as DelegateCategory)} style={INPUT} disabled={!!delegate}>
                <option value="OFFICIAL">Technical official / referee</option>
                <option value="VOLUNTEER">Volunteer</option>
                <option value="FACULTY">ACS faculty</option>
                <option value="PED">PED of a participating college</option>
              </select>
            </Field>

            {category === 'PED' && (
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

            <Field label={nameOptional ? 'Full name (optional)' : 'Full name *'}>
              <input name="fullName" defaultValue={delegate?.full_name || ''} required={!nameOptional} maxLength={80} style={INPUT} />
            </Field>

            {category === 'OFFICIAL' && (
              <Field label="Role *">
                <select name="designation" defaultValue={delegate?.designation || 'Track Referee'} required style={INPUT}>
                  {OFFICIAL_ROLES.filter((r) => r !== 'Volunteer').map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {category === 'FACULTY' && (
              <Field label="Designation">
                <select name="designation" defaultValue={delegate?.designation || ''} style={INPUT}>
                  <option value="">—</option>
                  {FACULTY_DESIGNATIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {category === 'PED' && <input type="hidden" name="designation" value={PED_DESIGNATION} />}

            {category === 'OFFICIAL' && (
              <Field label="Deputed by">
                <input name="organisation" defaultValue={delegate?.organisation || ''} maxLength={80} style={INPUT} />
              </Field>
            )}
            {category === 'FACULTY' && (
              <Field label="Department">
                <input name="department" defaultValue={delegate?.department || ''} maxLength={60} style={INPUT} />
              </Field>
            )}

            <Field label="Mobile number">
              <input name="phone" defaultValue={delegate?.phone || ''} inputMode="numeric" placeholder="10 digits" style={INPUT} />
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

            {category === 'PED' && (
              <Field label="In charge of">
                <select name="scope" defaultValue={delegate?.squad_scope || 'BOTH'} style={INPUT}>
                  <option value="BOTH">Men&rsquo;s &amp; Women&rsquo;s squads</option>
                  <option value="MEN">Men&rsquo;s squad</option>
                  <option value="WOMEN">Women&rsquo;s squad</option>
                </select>
              </Field>
            )}

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
  const cancelled = status === 'WITHDRAWN';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.18rem 0.55rem',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 800,
        background: cancelled ? '#fef2f2' : '#ecfdf5',
        color: cancelled ? '#b91c1c' : '#047857',
      }}
    >
      {cancelled ? 'Cancelled' : 'Active'}
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
const H3: React.CSSProperties = { margin: '0 0 0.3rem', fontSize: '0.98rem', fontWeight: 850, color: '#0f172a' };
const P: React.CSSProperties = { margin: '0 0 0.7rem', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.45 };
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
