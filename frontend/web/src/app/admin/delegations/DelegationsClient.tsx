'use client';

import { useState } from 'react';

import { DB_CODE_TO_OFFICIAL_MAP } from '@/lib/championship-events';
import { VTU_DIVISIONS, collegeDivision } from '@/lib/college-regions';

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
  const [selectedDivision, setSelectedDivision] = useState<string>('ALL');
  const [skipEmpty, setSkipEmpty] = useState(true);

  const divisionOf = (sq: any) =>
    collegeDivision(sq.colleges?.code || String(sq.squad_code || '').split('-')[0], sq.colleges?.region) || 'Unassigned';
  const divisionOrder = [...VTU_DIVISIONS, 'Unassigned'];

  // Division, then college code, then Men before Women
  const ordered = [...squads].sort((a, b) => {
    const da = divisionOrder.indexOf(divisionOf(a)), db = divisionOrder.indexOf(divisionOf(b));
    if (da !== db) return da - db;
    const ca = a.colleges?.code || a.squad_code || '';
    const cb = b.colleges?.code || b.squad_code || '';
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.gender === 'men' ? 0 : 1) - (b.gender === 'men' ? 0 : 1);
  });
  const hasAthletes = (sq: any) => (sq.profiles || []).length > 0;
  const inDivision = (sq: any) => selectedDivision === 'ALL' || divisionOf(sq) === selectedDivision;

  const visibleSquads = ordered.filter((sq) => inDivision(sq) && (!skipEmpty || hasAthletes(sq)));
  const emptyInView = ordered.filter((sq) => inDivision(sq) && !hasAthletes(sq)).length;

  // Squads / athletes per division for the picker
  const divisionStats = divisionOrder
    .map((d) => {
      const list = ordered.filter((sq) => divisionOf(sq) === d);
      return {
        division: d,
        squads: list.filter(hasAthletes).length,
        athletes: list.reduce((n, sq) => n + (sq.profiles || []).length, 0),
        total: list.length,
      };
    })
    .filter((d) => d.total > 0);
  const totalAthletes = divisionStats.reduce((n, d) => n + d.athletes, 0);

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
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            className="filter-control"
            style={{ minWidth: '320px' }}
            id="deleg-division"
            aria-label="VTU division"
          >
            <option value="ALL">All Divisions ({totalAthletes} athletes)</option>
            {divisionStats.map((d) => (
              <option key={d.division} value={d.division}>
                {d.division === 'Unassigned' ? 'Unassigned (no division)' : `${d.division} Division`} — {d.squads} squads with athletes, {d.athletes} athletes
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
            Skip squads with no athletes ({emptyInView})
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
              {/* ONE table per sheet: its <thead> (letterhead, college details, column titles) and
                  <tfoot> (signatures) repeat on every printed page if the roster runs over a page. */}
              <table className="deleg-roster">
                <thead>
                  <tr className="deleg-frame-row">
                    <td colSpan={7} className="deleg-frame-cell">
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
                            <th>Men / Women</th>
                            <td>
                              <strong>{sq.gender === 'men' ? 'Men' : 'Women'}</strong>
                              <div className="deleg-info-sub">{sq.squad_code}</div>
                            </td>
                          </tr>
                          <tr>
                            <th>Physical Education Director</th>
                            <td>
                              <div className="deleg-ped">
                                <strong className="deleg-ped-name">{sq.ped_name || '—'}</strong>
                                {sq.ped_phone && <span className="deleg-chip">📞 {sq.ped_phone}</span>}
                                {sq.ped_email && <span className="deleg-chip">✉️ {sq.ped_email}</span>}
                              </div>
                            </td>
                            <th>VTU Division</th>
                            <td>
                              <div className="deleg-ped">
                                <strong>📍 {divisionOf(sq)}</strong>
                                <span className="deleg-chip">👥 {athletes.length} athlete{athletes.length === 1 ? '' : 's'}</span>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
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
                <tfoot>
                  <tr className="deleg-frame-row">
                    <td colSpan={7} className="deleg-frame-cell">
                      {/* Sign-off */}
                      <div className="deleg-signatures">
                        <div className="deleg-sig">
                          <div className="deleg-sig-space" />
                          <div className="deleg-sig-title">Physical Education Director / Team Manager</div>
                          <div className="deleg-sig-sub">Signature with College Seal</div>
                        </div>
                        <div className="deleg-sig">
                          <div className="deleg-sig-space" />
                          <div className="deleg-sig-title">Principal</div>
                          <div className="deleg-sig-sub">Signature &amp; Seal of {colName}</div>
                        </div>
                        <div className="deleg-sig">
                          <div className="deleg-sig-space" />
                          <div className="deleg-sig-title">Registration Desk Official</div>
                          <div className="deleg-sig-sub">Dr. ACS College of Engineering</div>
                        </div>
                      </div>
                      <div className="deleg-date">Date &amp; Time of Arrival: ______________________</div>
                    </td>
                  </tr>
                </tfoot>
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
        .deleg-ped {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.3rem 0.9rem;
        }
        .deleg-ped-name {
          flex-basis: 100%;
        }
        .deleg-chip {
          font-size: 0.78rem;
          white-space: nowrap;
        }
        .deleg-info-sub {
          font-size: 0.75rem;
          margin-top: 0.1rem;
        }
        /* Wrapper cells holding the letterhead (thead) and signatures (tfoot): no grid lines */
        .deleg-roster > thead > tr > td.deleg-frame-cell,
        .deleg-roster > tfoot > tr > td.deleg-frame-cell {
          border: none;
          padding: 0;
          background: transparent;
        }
        .deleg-roster > tfoot > tr > td.deleg-frame-cell {
          padding-top: 0.25rem;
        }
        .deleg-roster > thead > tr > th {
          text-align: center;
        }
        .deleg-roster > tbody > tr {
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
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1.5rem;
          margin-top: 2.25rem;
        }
        .deleg-sig {
          text-align: center;
        }
        .deleg-sig-space {
          /* room for a signature plus the college seal */
          height: 64px;
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
        @media screen and (max-width: 760px) {
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
          /* Header (letterhead + college details + column titles) and footer (signatures)
             repeat on every page when a roster runs over one page */
          .deleg-roster > thead {
            display: table-header-group;
          }
          .deleg-roster > tfoot {
            display: table-footer-group;
          }
          .deleg-roster tr {
            break-inside: avoid;
          }
          /* Compact print sizes: a typical squad fits on ONE A4 landscape page */
          .deleg-logo,
          .deleg-logo-spacer {
            width: 46px;
            height: 46px;
          }
          .deleg-letterhead {
            padding-bottom: 0.2rem;
            margin-bottom: 0.35rem;
          }
          .deleg-host-name {
            font-size: 1.05rem;
          }
          .deleg-host-sub {
            font-size: 0.66rem;
          }
          .deleg-meet {
            font-size: 0.7rem;
            margin-top: 0;
          }
          .deleg-title {
            margin-top: 0.1rem;
            font-size: 0.85rem;
          }
          .deleg-info {
            margin-bottom: 0.35rem;
          }
          th,
          td {
            padding: 0.12rem 0.35rem;
            font-size: 0.72rem;
          }
          .deleg-chip,
          .deleg-info-sub,
          .mono {
            font-size: 0.68rem;
          }
          .deleg-roster > tbody > tr {
            height: 20px;
          }
          .deleg-tick {
            width: 12px;
            height: 12px;
          }
          .deleg-signatures {
            margin-top: 0.6rem;
            gap: 1rem;
          }
          .deleg-sig-space {
            height: 46px;
          }
          .deleg-sig-title {
            font-size: 0.72rem;
          }
          .deleg-sig-sub,
          .deleg-date {
            font-size: 0.66rem;
          }
          .deleg-date {
            margin-top: 0.3rem;
          }
          th {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      <style jsx global>{`
        /* Delegation sheets ALWAYS print on A4 landscape. admin.css sets '@page { size: auto }'
           for every admin page, and Chrome lets a later stylesheet's size win even over a named
           page — so the size is !important (tested: later 'size: auto' no longer overrides it).
           With a fixed size the print dialog does not offer a portrait option. */
        @page delegation-sheet {
          size: A4 landscape !important;
          margin: 8mm;
        }
        @media print {
          @page {
            size: A4 landscape !important;
            margin: 8mm;
          }
          .deleg-sheet {
            page: delegation-sheet;
          }
        }
      `}</style>
    </div>
  );
}
