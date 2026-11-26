'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EventGroup } from '@/lib/athlete-export';
import { EVENT_WISE_COLUMNS } from '@/lib/athlete-export';
import { REPORT_MEET, REPORT_ORG } from '@/lib/athlete-xlsx';

interface Props {
  title: string;
  groups: EventGroup[];
  onClose: () => void;
}

const CENTER = new Set(['Sl No', 'Bib No', 'Sem', 'College Code', 'Entered As', 'Payment Status']);

/**
 * Printable event-wise athlete list (A4 landscape): one block per event, like the Excel
 * "Event-wise" sheet. "Download PDF" opens the print dialog, where "Save as PDF" makes the file.
 * The header (logo, college, meet, title, filters) repeats on every printed page: the whole
 * report is one table whose <thead> holds it. Page numbers come from the @page footer.
 */
export default function AthletesPdfReport({ title, groups, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="apdf-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="apdf-bar no-print">
        <span className="apdf-bar-title">📄 {title} — {groups.length} {groups.length === 1 ? 'event' : 'events'}</span>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" className="apdf-btn-primary" onClick={() => window.print()} id="btn-athletes-pdf-print">
            ⬇️ Download / Save as PDF
          </button>
          <button type="button" className="apdf-btn" onClick={onClose}>
            ✕ Close
          </button>
        </div>
      </div>

      <div className="apdf-paper" id="printable-athletes-report">
        <table className="apdf-frame">
          <thead>
            <tr>
              <td>
                <div className="apdf-head">
                  <img src="/logo.jpeg" alt="Dr. ACSCE logo" className="apdf-logo" />
                  <div className="apdf-head-text">
                    <div className="apdf-org">{REPORT_ORG}</div>
                    <div className="apdf-meet">{REPORT_MEET}</div>
                    <div className="apdf-title">{title}</div>
                  </div>
                  <div className="apdf-logo-spacer" aria-hidden="true" />
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {groups.length === 0 ? (
                  <p className="apdf-empty">No athletes are entered in the selected event(s).</p>
                ) : (
                  groups.map((g) => (
                    <section className="apdf-event" key={g.key}>
                      <div className="apdf-event-bar">
                        {g.title}
                        <span className="apdf-event-count">
                          ({g.entries} {g.entries === 1 ? 'entry' : 'entries'}, {g.reserves} {g.reserves === 1 ? 'reserve' : 'reserves'})
                        </span>
                      </div>
                      {[
                        { rows: g.rows, reserve: false },
                        { rows: g.reserveRows, reserve: true },
                      ].map(({ rows, reserve }) =>
                        rows.length === 0 ? (
                          reserve ? null : (
                            <p key="none" className="apdf-none">No entries (reserves only)</p>
                          )
                        ) : (
                          <div key={reserve ? 'res' : 'ent'}>
                            {reserve && (
                              <div className="apdf-res-bar">
                                Reserves — {g.title} <span className="apdf-event-count">({rows.length})</span>
                              </div>
                            )}
                            <table className="apdf-table">
                              <thead>
                                <tr>
                                  {EVENT_WISE_COLUMNS.map((c) => (
                                    <th key={c}>{c}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r['Sl No']}>
                                    {EVENT_WISE_COLUMNS.map((c) => (
                                      <td
                                        key={c}
                                        className={c === 'Athlete Name' ? 'b' : c === 'USN' || c === 'Student Phone' ? 'mono' : CENTER.has(c) ? 'c' : undefined}
                                      >
                                        {r[c]}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      )}
                    </section>
                  ))
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .apdf-overlay {
          position: fixed;
          inset: 0;
          z-index: 100000;
          overflow: auto;
          background: rgba(15, 23, 42, 0.85);
          padding: 1rem 16px 3rem;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .apdf-bar {
          width: 100%;
          max-width: 1400px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.75rem;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 0.7rem 1rem;
          margin-bottom: 1rem;
        }
        .apdf-bar-title {
          color: #fff;
          font-weight: 800;
        }
        .apdf-btn-primary {
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 0.55rem 1.1rem;
          font-weight: 700;
          cursor: pointer;
        }
        .apdf-btn {
          background: rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
          border: 1px solid #475569;
          border-radius: 6px;
          padding: 0.55rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .apdf-paper {
          width: 100%;
          max-width: 1400px;
          background: #fff;
          color: #0f172a;
          border-radius: 6px;
          padding: 1.25rem;
          overflow-x: auto;
          font-family: Arial, Helvetica, sans-serif;
        }
        .apdf-head {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 0.5rem;
        }
        .apdf-logo,
        .apdf-logo-spacer {
          width: 56px;
          height: 56px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .apdf-head-text {
          flex: 1;
          text-align: center;
        }
        .apdf-org {
          font-size: 1.05rem;
          font-weight: 900;
        }
        .apdf-meet {
          font-size: 0.8rem;
          font-weight: 700;
          color: #334155;
        }
        .apdf-title {
          margin-top: 0.2rem;
          font-size: 0.95rem;
          font-weight: 800;
          text-decoration: underline;
        }
        .apdf-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem 1.25rem;
          font-size: 0.75rem;
          color: #334155;
          margin: 0.6rem 0;
        }
        .apdf-frame {
          width: 100%;
          border-collapse: collapse;
        }
        .apdf-frame > thead > tr > td,
        .apdf-frame > tbody > tr > td {
          padding: 0;
          border: none;
        }
        .apdf-event {
          margin-top: 0.7rem;
        }
        .apdf-event-bar {
          background: #1f4e78;
          color: #fff;
          font-weight: 800;
          font-size: 0.85rem;
          padding: 0.3rem 0.5rem;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          break-after: avoid;
        }
        .apdf-event-count {
          font-weight: 600;
          margin-left: 0.6rem;
        }
        .apdf-empty {
          padding: 2rem;
          text-align: center;
          color: #475569;
        }
        .apdf-res-bar {
          margin-top: 0.35rem;
          background: #fff2cc;
          color: #7c2d12;
          border: 1px solid #94a3b8;
          border-bottom: none;
          font-weight: 800;
          font-size: 0.78rem;
          padding: 0.22rem 0.5rem;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          break-after: avoid;
        }
        .apdf-none {
          margin: 0.3rem 0;
          font-size: 0.75rem;
          font-style: italic;
          color: #64748b;
        }
        .apdf-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1000px;
        }
        .apdf-table th,
        .apdf-table td {
          border: 1px solid #94a3b8;
          padding: 0.25rem 0.35rem;
          font-size: 0.7rem;
          vertical-align: top;
          text-align: left;
        }
        .apdf-table th {
          background: #e2e8f0;
          font-weight: 800;
          text-align: center;
        }
        .apdf-table tbody tr:nth-child(even) {
          background: #f8fafc;
        }
        .c {
          text-align: center !important;
        }
        .b {
          font-weight: 700;
          text-transform: uppercase;
        }
        .mono {
          font-family: 'Courier New', monospace;
        }
        .sub {
          font-size: 0.62rem;
          color: #475569;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          .apdf-overlay {
            position: static !important;
            overflow: visible !important;
            background: none !important;
            padding: 0 !important;
          }
          .apdf-paper {
            max-width: none !important;
            padding: 0 !important;
            overflow: visible !important;
            border-radius: 0 !important;
          }
          .apdf-table {
            min-width: 0 !important;
          }
          .apdf-table thead,
          .apdf-frame > thead {
            display: table-header-group;
          }
          .apdf-head {
            padding-top: 0;
          }
          .apdf-table tr {
            break-inside: avoid;
          }
          .apdf-table th {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm 8mm 11mm;
            @bottom-left {
              content: 'Dr. ACS-AURA 2026 — Athletes by Event';
              font-size: 8pt;
              color: #475569;
            }
            @bottom-right {
              content: 'Page ' counter(page) ' of ' counter(pages);
              font-size: 8pt;
              color: #475569;
            }
          }
          body > *:not(.apdf-overlay) {
            display: none !important;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
