'use client';

/**
 * Printable sheet of faculty / PED / official passes — one 4×6″ pass per page.
 * Used by the contingent portal (its own college) and by the meet office (anyone).
 */

import Link from 'next/link';
import DelegatePass, { type PassDelegate } from './DelegatePass';
import { idFontVars } from './fonts';

export default function PassSheet({
  delegates,
  title,
  subtitle,
  backHref,
  backLabel,
}: {
  delegates: PassDelegate[];
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div style={{ padding: '1.25rem 1rem 3rem', maxWidth: 1400, margin: '0 auto' }}>
      <div
        className="no-print"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>{title}</h1>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#475569', maxWidth: '80ch' }}>{subtitle}</p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            In the print dialog choose <strong>Save as PDF</strong>, Margins: <strong>None</strong>, Background graphics:{' '}
            <strong>on</strong>. Each pass prints on its own 4×6 inch page.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link
            href={backHref}
            style={{ padding: '0.5rem 0.9rem', borderRadius: 9, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 700, fontSize: '0.84rem', textDecoration: 'none' }}
          >
            ← {backLabel}
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ padding: '0.55rem 1rem', borderRadius: 9, border: '1px solid #1d4ed8', background: '#1d4ed8', color: '#fff', fontWeight: 750, fontSize: '0.86rem', cursor: 'pointer' }}
          >
            📄 Print / Save PDF · {delegates.length} passes
          </button>
        </div>
      </div>

      {delegates.length === 0 ? (
        <div
          className="no-print"
          style={{ background: '#fff', borderRadius: 12, padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8', border: '1px solid #e2e8f0' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎟️</div>
          <div style={{ fontWeight: 600, color: '#475569' }}>No passes to print yet</div>
        </div>
      ) : (
        <div className={`idc-sheet ${idFontVars}`}>
          {delegates.map((d) => (
            <DelegatePass key={d.id} delegate={d} />
          ))}
        </div>
      )}
    </div>
  );
}
