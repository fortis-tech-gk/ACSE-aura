'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExportRow } from '@/lib/athlete-export';

interface Props {
  title: string;
  filterSummary: string;
  rows: ExportRow[];
  onClose: () => void;
}

/**
 * Printable A4-landscape athlete list. "Download PDF" opens the browser's print dialog,
 * where "Save as PDF" produces the file (same approach as the invoice and certificates).
 */
export default function AthletesPdfReport({ title, filterSummary, rows, onClose }: Props) {
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

  const generated = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const men = rows.filter((r) => r.Division === 'Men').length;
  const women = rows.filter((r) => r.Division === 'Women').length;
  const colleges = new Set(rows.map((r) => r['College Code'])).size;

  return createPortal(
    <div className="apdf-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="apdf-bar no-print">
        <span className="apdf-bar-title">📄 {title} — {rows.length} athletes</span>
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
        <div className="apdf-head">
          <img src="/logo.jpeg" alt="Dr. ACSCE logo" className="apdf-logo" />
          <div className="apdf-head-text">
            <div className="apdf-org">Dr. ACS COLLEGE OF ENGINEERING, BENGALURU</div>
            <div className="apdf-meet">VTU&rsquo;s 28th Inter-Collegiate State Level Athletic Meet 2026 &bull; Dr. ACS-AURA 2026</div>
            <div className="apdf-title">{title}</div>
          </div>
          <div className="apdf-logo-spacer" aria-hidden="true" />
        </div>

        <div className="apdf-meta">
          <span><strong>{rows.length}</strong> athletes</span>
          <span><strong>{men}</strong> men &bull; <strong>{women}</strong> women</span>
          <span><strong>{colleges}</strong> colleges</span>
          <span>Filters: {filterSummary}</span>
          <span>Generated: {generated}</span>
        </div>

        <table className="apdf-table">
          <thead>
            <tr>
              <th>Sl</th>
              <th>Bib</th>
              <th>Athlete Name</th>
              <th>USN</th>
              <th>M/W</th>
              <th>Sem</th>
              <th>Blood</th>
              <th>DOB</th>
              <th>Phone</th>
              <th>College</th>
              <th>Event 1</th>
              <th>Event 2</th>
              <th>Reserve</th>
              <th>Relay / HM</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={15} className="c">No athletes match the current filters.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r['Sl No']}>
                  <td className="c">{r['Sl No']}</td>
                  <td className="c">{r['Bib No']}</td>
                  <td className="b">{r['Athlete Name (SSLC)']}</td>
                  <td className="mono">{r.USN}</td>
                  <td className="c">{r.Division === 'Men' ? 'M' : r.Division === 'Women' ? 'W' : ''}</td>
                  <td className="c">{r.Semester}</td>
                  <td className="c">{r['Blood Group']}</td>
                  <td className="c">{r['Date of Birth']}</td>
                  <td className="mono">{r['Student Phone']}</td>
                  <td>
                    <strong>{r['College Code']}</strong>
                    {r['College Name'] ? <div className="sub">{r['College Name']}</div> : null}
                  </td>
                  <td>{r['Event 1']}</td>
                  <td>{r['Event 2']}</td>
                  <td>{r['Reserve Event']}</td>
                  <td>
                    {r.Relays}
                    {r['Half Marathon'] ? <div>[23] 21km Half Marathon</div> : null}
                  </td>
                  <td className="c">{r['Payment Status']}</td>
                </tr>
              ))
            )}
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
        .apdf-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1100px;
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
          .apdf-table thead {
            display: table-header-group;
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
            margin: 8mm;
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
