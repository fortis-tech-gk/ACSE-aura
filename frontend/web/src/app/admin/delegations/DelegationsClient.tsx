'use client';

import { useState } from 'react';

import { DB_CODE_TO_OFFICIAL_MAP } from '@/lib/championship-events';

interface Props {
  squads: any[];
}

/** "[1] 100 mtrs Run, [3] 400 mtrs Run (Reserve), [20] 4 x 100 mtr Relay" */
function eventsText(regs: any[] | undefined): string {
  const list = (regs || []).map((r: any) => {
    const meta = DB_CODE_TO_OFFICIAL_MAP[String(r.events?.code || '').toUpperCase()];
    const label = meta ? `[${meta.codeNum}] ${meta.officialName}` : r.events?.name || 'Event';
    return r.kind === 'reserve' ? `${label} (Reserve)` : label;
  });
  return list.length ? list.join(', ') : '—';
}

export default function DelegationsClient({ squads }: Props) {
  const [selectedSquadId, setSelectedSquadId] = useState<string>('ALL');
  const [skipEmpty, setSkipEmpty] = useState(true);

  // College code, then Men before Women
  const ordered = [...squads].sort((a, b) => {
    const ca = a.colleges?.code || a.squad_code || '';
    const cb = b.colleges?.code || b.squad_code || '';
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.gender === 'men' ? 0 : 1) - (b.gender === 'men' ? 0 : 1);
  });
  const withAthletes = ordered.filter((s) => (s.profiles || []).length > 0);
  const pool = skipEmpty ? withAthletes : ordered;

  const visibleSquads = selectedSquadId === 'ALL'
    ? pool
    : ordered.filter((s) => s.id === selectedSquadId);

  return (
    <div>
      {/* Page Header (No print) */}
      <div className="admin-page-header no-print">
        <div className="admin-title-group">
          <h2>College Delegation Check-in Sheets</h2>
          <p>Arrival &amp; check-in sign-off sheet for each college contingent • prints one squad per page</p>
        </div>

        <div className="admin-actions-group">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-admin btn-admin-primary"
            id="btn-print-delegations"
          >
            <span>🖨️</span>
            <span>Print Delegation Sheets</span>
          </button>
        </div>
      </div>

      {/* Filter (No print) */}
      <div className="filter-bar no-print">
        <div className="filter-inputs">
          <select
            value={selectedSquadId}
            onChange={(e) => setSelectedSquadId(e.target.value)}
            className="filter-control"
            style={{ minWidth: '320px' }}
          >
            <option value="ALL">All College Delegations ({pool.length})</option>
            {ordered.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.colleges?.code || sq.squad_code} — {sq.colleges?.name || 'College'} ({sq.gender === 'men' ? 'Men' : 'Women'}) • {(sq.profiles || []).length} athletes
              </option>
            ))}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
            <input
              type="checkbox"
              checked={skipEmpty}
              onChange={(e) => setSkipEmpty(e.target.checked)}
              id="deleg-skip-empty"
            />
            Skip squads with no athletes ({ordered.length - withAthletes.length})
          </label>
        </div>

        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Selected: <strong>{visibleSquads.length}</strong> delegation sheet(s)
        </div>
      </div>

      {/* Printable Delegation Sheets — one squad per printed page */}
      <div className="deleg-sheets">
        {visibleSquads.map((sq) => {
          const colName = sq.colleges?.name || sq.squad_code;
          const colCode = sq.colleges?.code || sq.squad_code;
          const district = sq.colleges?.district || '';
          const athletes = [...(sq.profiles || [])].sort((a: any, b: any) =>
            String(a.sslc_name || '').localeCompare(String(b.sslc_name || ''))
          );

          return (
            <section key={sq.id} className="deleg-sheet printable-signoff-sheet">
              {/* Letterhead — same order as the fee invoice: ACSCE logo, host college, meet */}
              <div className="deleg-letterhead">
                <img src="/logo.jpeg" alt="Dr. ACSCE logo" className="deleg-logo" />
                <div className="deleg-letterhead-text">
                  <div className="deleg-host-sub">Visvesvaraya Technological University, Belagavi</div>
                  <div className="deleg-host-name">Dr. ACS COLLEGE OF ENGINEERING</div>
                  <div className="deleg-host-sub">Kambipura, Mysore Road, Bengaluru – 560074, Karnataka</div>
                  <div className="deleg-meet">
                    VTU&rsquo;s 28th Inter-Collegiate State Level Athletic Meet 2026 &bull; Dr. ACS-AURA 2026 &bull; 7th – 10th December 2026
                  </div>
                  <div className="deleg-title">Delegation Arrival &amp; Check-in Sign-off Sheet</div>
                </div>
                <div className="deleg-logo-spacer" aria-hidden="true" />
              </div>

              {/* College & PED */}
              <table className="deleg-info">
                <tbody>
                  <tr>
                    <th>Name of the College</th>
                    <td>
                      <strong>{colName}</strong>
                      {district ? `, ${district}` : ''}
                      <div className="deleg-info-sub">College Code: <strong>{colCode}</strong></div>
                    </td>
                    <th>Division / Squad</th>
                    <td>
                      <strong>{sq.gender === 'men' ? 'Men' : 'Women'}</strong>
                      <div className="deleg-info-sub">{sq.squad_code}</div>
                    </td>
                  </tr>
                  <tr>
                    <th>Physical Education Director</th>
                    <td>
                      <strong>{sq.ped_name || '—'}</strong>
                      <div className="deleg-info-sub">{[sq.ped_phone, sq.ped_email].filter(Boolean).join(' • ')}</div>
                    </td>
                    <th>Athletes</th>
                    <td>
                      <strong>{athletes.length}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Roster */}
              <table className="deleg-roster">
                <thead>
                  <tr>
                    <th style={{ width: '34px' }}>Sl.</th>
                    <th style={{ width: '64px' }}>Bib No.</th>
                    <th>Name of the Athlete</th>
                    <th style={{ width: '112px' }}>University Seat No.</th>
                    <th style={{ width: '44px' }}>Sem</th>
                    <th>Events (code)</th>
                    <th style={{ width: '70px' }}>Present</th>
                  </tr>
                </thead>
                <tbody>
                  {athletes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="c muted">No athletes registered in this contingent.</td>
                    </tr>
                  ) : (
                    athletes.map((ath: any, idx: number) => (
                      <tr key={ath.id}>
                        <td className="c">{idx + 1}</td>
                        <td className="c b">{ath.bid_number || '—'}</td>
                        <td className="b name">{ath.sslc_name}</td>
                        <td className="mono">{ath.usn}</td>
                        <td className="c">{ath.semester || '—'}</td>
                        <td>{eventsText(ath.registrations)}</td>
                        <td className="c">
                          <span className="deleg-tick" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* Sign-off */}
              <div className="deleg-signatures">
                <div className="deleg-sig">
                  <div className="deleg-sig-space" />
                  <div className="deleg-sig-title">Physical Education Director / Team Manager</div>
                  <div className="deleg-sig-sub">Signature with College Seal</div>
                </div>
                <div className="deleg-sig">
                  <div className="deleg-sig-space" />
                  <div className="deleg-sig-title">Registration Desk Official</div>
                  <div className="deleg-sig-sub">Dr. ACS College of Engineering</div>
                </div>
              </div>
              <div className="deleg-date">Date &amp; Time of Arrival: ______________________</div>
            </section>
          );
        })}
      </div>

      <style jsx>{`
        .deleg-sheets {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        .deleg-sheet {
          background: #fff;
          color: #000;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 1.5rem 1.75rem;
          font-family: 'Times New Roman', Times, serif;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          overflow-x: auto;
        }
        .deleg-letterhead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid #000;
          padding-bottom: 0.5rem;
          margin-bottom: 0.75rem;
        }
        .deleg-logo,
        .deleg-logo-spacer {
          width: 64px;
          height: 64px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .deleg-letterhead-text {
          flex: 1;
          text-align: center;
        }
        .deleg-host-name {
          font-size: 1.35rem;
          font-weight: 900;
          letter-spacing: 0.02em;
        }
        .deleg-host-sub {
          font-size: 0.75rem;
        }
        .deleg-meet {
          font-size: 0.82rem;
          font-weight: 700;
          margin-top: 0.15rem;
        }
        .deleg-title {
          display: inline-block;
          margin-top: 0.3rem;
          font-size: 1rem;
          font-weight: 800;
          text-decoration: underline;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th,
        td {
          border: 1px solid #000;
          padding: 0.3rem 0.45rem;
          font-size: 0.82rem;
          vertical-align: middle;
        }
        th {
          background: #f3f4f6;
          font-weight: 700;
        }
        .deleg-info {
          margin-bottom: 0.75rem;
        }
        .deleg-info th {
          width: 18%;
          text-align: left;
        }
        .deleg-info td {
          width: 32%;
        }
        .deleg-info-sub {
          font-size: 0.75rem;
          margin-top: 0.1rem;
        }
        .deleg-roster th {
          text-align: center;
        }
        .deleg-roster tbody tr {
          height: 26px;
        }
        .c {
          text-align: center;
        }
        .b {
          font-weight: 700;
        }
        .name {
          text-transform: uppercase;
        }
        .mono {
          font-family: 'Courier New', monospace;
          font-size: 0.78rem;
        }
        .muted {
          color: #64748b;
          padding: 1rem;
        }
        .deleg-tick {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 1px solid #000;
        }
        .deleg-signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          margin-top: 2.25rem;
        }
        .deleg-sig {
          text-align: center;
        }
        .deleg-sig-space {
          height: 44px;
          border-bottom: 1px solid #000;
          margin: 0 1.5rem 0.3rem;
        }
        .deleg-sig-title {
          font-weight: 800;
          font-size: 0.82rem;
        }
        .deleg-sig-sub {
          font-size: 0.74rem;
        }
        .deleg-date {
          margin-top: 1rem;
          font-size: 0.8rem;
        }
        @media (max-width: 760px) {
          .deleg-sheet {
            padding: 1rem;
          }
          .deleg-info th,
          .deleg-info td {
            display: block;
            width: auto;
          }
          .deleg-signatures {
            grid-template-columns: 1fr;
          }
        }
        @media print {
          .deleg-sheets {
            display: block;
          }
          .deleg-sheet {
            border: none;
            border-radius: 0;
            box-shadow: none;
            padding: 0;
            overflow: visible;
            break-after: page;
            page-break-after: always;
          }
          .deleg-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .deleg-roster thead {
            display: table-header-group;
          }
          .deleg-roster tr {
            break-inside: avoid;
          }
          th {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  );
}
