'use client';

import { useMemo, useState } from 'react';
import { checkInCollegeAction, type DeskCollege } from '@/app/actions/attendance';

interface Props {
  initialColleges: DeskCollege[];
  migrationApplied: boolean;
}

type Filter = 'all' | 'pending' | 'attended';

const PAYMENT_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  VERIFIED: { text: 'Paid', color: '#15803d', bg: '#f0fdf4' },
  SUBMITTED: { text: 'Payment pending', color: '#b45309', bg: '#fffbeb' },
  REJECTED: { text: 'Payment rejected', color: '#b91c1c', bg: '#fef2f2' },
  DRAFT: { text: 'Not paid', color: '#64748b', bg: '#f1f5f9' },
};

export default function RegistrationDeskClient({ initialColleges, migrationApplied }: Props) {
  const [colleges, setColleges] = useState<DeskCollege[]>(initialColleges);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const registered = (c: DeskCollege, g: 'men' | 'women') => c.squads.find((s) => s.gender === g)?.athlete_count ?? 0;

  const attendedCount = colleges.filter((c) => c.attendance_marked_at).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colleges.filter((c) => {
      if (filter === 'pending' && c.attendance_marked_at) return false;
      if (filter === 'attended' && !c.attendance_marked_at) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.district || '').toLowerCase().includes(q) ||
        c.squads.some((s) => s.squad_code.toLowerCase().includes(q) || s.ped_name.toLowerCase().includes(q))
      );
    });
  }, [colleges, search, filter]);

  const competedCount = colleges.reduce((n, c) => n + c.competed_men + c.competed_women, 0);

  async function handleCheckIn(c: DeskCollege) {
    if (
      !confirm(
        `Check in ${c.name} (${c.code})?\n\nEvery athlete of the college is accredited and the Attendance Certificate unlocks. Use this only when the accreditation desk app cannot scan.`
      )
    )
      return;
    setBusyId(c.id);
    try {
      const res = await checkInCollegeAction(c.id);
      if (res.success) {
        setColleges((prev) =>
          prev.map((x) =>
            x.id === c.id ? { ...x, attendance_marked_at: res.markedAt || new Date().toISOString(), attendance_marked_by: res.markedBy || null } : x
          )
        );
      } else {
        alert(`Could not check in: ${res.error}`);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div id="registration-desk">
      <div className="admin-page-header">
        <div className="admin-title-group">
          <h2>Arrivals &amp; Attendance</h2>
          <p>
            A college is checked in when the accreditation desk scans <strong>any one</strong> of its athletes in the AURA
            Officials app. That accredits the whole college and unlocks its Attendance Certificate. <em>Competed</em> counts
            athletes who reported at a roll call or call room at least once.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="desk-stat">
            <span className="desk-stat-num">{attendedCount}</span>
            <span className="desk-stat-lbl">Checked in</span>
          </div>
          <div className="desk-stat">
            <span className="desk-stat-num">{colleges.length - attendedCount}</span>
            <span className="desk-stat-lbl">Yet to report</span>
          </div>
          <div className="desk-stat">
            <span className="desk-stat-num">{competedCount}</span>
            <span className="desk-stat-lbl">Athletes competed</span>
          </div>
        </div>
      </div>

      {!migrationApplied && (
        <div className="desk-warning" role="alert">
          ⚠️ Database migration <strong>0054_college_checkin.sql</strong> has not been applied yet, so college check-in and
          competed counts are not available. Ask the Meet Admin to apply it.
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-inputs">
          <input
            type="search"
            className="filter-control"
            placeholder="Search college name, code, district, squad code or PED…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 'min(360px, 100%)' }}
            aria-label="Search colleges"
            id="desk-search"
          />
          <select
            className="filter-control"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label="Filter by attendance"
          >
            <option value="all">All colleges ({colleges.length})</option>
            <option value="pending">Yet to report ({colleges.length - attendedCount})</option>
            <option value="attended">Checked in ({attendedCount})</option>
          </select>
        </div>
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Showing <strong>{visible.length}</strong>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table" id="desk-colleges-table">
          <thead>
            <tr>
              <th>College</th>
              <th>PED</th>
              <th style={{ textAlign: 'center' }}>Registered (M / W)</th>
              <th>Fee status</th>
              <th>Check-in</th>
              <th style={{ textAlign: 'center' }}>Competed (M / W)</th>
              <th style={{ textAlign: 'right' }}>Fallback</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                  No colleges match this search.
                </td>
              </tr>
            ) : (
              visible.map((c) => {
                const menSq = c.squads.find((s) => s.gender === 'men');
                const womenSq = c.squads.find((s) => s.gender === 'women');
                const ped = menSq?.ped_name || womenSq?.ped_name || '—';
                const phone = menSq?.ped_phone || womenSq?.ped_phone || '';
                return (
                  <tr key={c.id} id={`desk-row-${c.code}`}>
                    <td>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{c.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        <strong style={{ color: '#b45309' }}>{c.code}</strong>
                        {c.district ? ` • ${c.district}` : ''}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.85rem' }}>{ped}</div>
                      {phone && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{phone}</div>}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>
                      {registered(c, 'men')} / {registered(c, 'women')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {[menSq, womenSq].map((sq) => {
                          if (!sq) return null;
                          const p = PAYMENT_LABEL[sq.payment_status] || PAYMENT_LABEL.DRAFT;
                          return (
                            <span key={sq.id} className="desk-pill" style={{ color: p.color, background: p.bg }}>
                              {sq.gender === 'men' ? 'M' : 'W'}: {p.text}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      {c.attendance_marked_at ? (
                        <div>
                          <span className="desk-pill" style={{ color: '#15803d', background: '#f0fdf4', fontWeight: 800 }}>
                            ✓ Checked in
                          </span>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {new Date(c.attendance_marked_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {c.attendance_marked_by ? ` • ${c.attendance_marked_by}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="desk-pill" style={{ color: '#64748b', background: '#f1f5f9' }}>
                          Not reported
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>
                      {c.competed_men} / {c.competed_women}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!c.attendance_marked_at && (
                        <button
                          type="button"
                          className="btn-admin"
                          onClick={() => handleCheckIn(c)}
                          disabled={!migrationApplied || busyId === c.id || !c.squads.some((sq) => sq.payment_status === 'VERIFIED')}
                          title={c.squads.some((sq) => sq.payment_status === 'VERIFIED') ? 'Use only if the app cannot scan' : 'Fee not verified yet'}
                          id={`btn-check-in-${c.code}`}
                        >
                          {busyId === c.id ? 'Checking in…' : 'Check in'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .desk-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 96px;
          padding: 0.5rem 0.9rem;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
        }
        .desk-stat-num {
          font-size: 1.4rem;
          font-weight: 900;
          color: #1e3a8a;
          line-height: 1.1;
        }
        .desk-stat-lbl {
          font-size: 0.7rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .desk-warning {
          padding: 0.75rem 1rem;
          margin-bottom: 1rem;
          border-radius: 8px;
          background: #fffbeb;
          border: 1px solid #fcd34d;
          color: #92400e;
          font-size: 0.85rem;
        }
        :global(.desk-pill) {
          display: inline-block;
          padding: 0.15rem 0.55rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
