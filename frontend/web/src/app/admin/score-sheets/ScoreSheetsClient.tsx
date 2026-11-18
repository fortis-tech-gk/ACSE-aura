'use client';

import { useMemo, useState } from 'react';

type Ev = { id: string; code: string; name: string; gender: string | null; category: string | null };
type Kind = 'track' | 'field' | 'vertical';

const MEET = {
  name: 'Dr. ACS-AURA 2026',
  subtitle: '28th VTU State Level Inter-Collegiate Athletic Meet',
  dates: '7–10 December 2026',
  venue: 'Dr. ACS College of Engineering, Bengaluru',
};
const GROUP: Record<string, string> = { men: 'MEN', women: 'WOMEN', mixed: 'MIXED' };

// Combined events (decathlon / heptathlon) have no standard card here
function kindOf(e: Ev): Kind | null {
  const c = e.category || '';
  if (c === 'combined') return null;
  if (c === 'field_vertical_jump') return 'vertical';
  if (c.startsWith('field_')) return 'field';
  return 'track';
}

const KIND_LABEL: Record<Kind, string> = { track: 'Track / relay / road', field: 'Throws and horizontal jumps', vertical: 'High jump and pole vault' };

function Info({ e, stage }: { e: Ev; stage: boolean }) {
  return (
    <table className="bs-info">
      <tbody>
        <tr>
          <td><div className="k">EVENT No.</div><div className="v">{e.code}</div></td>
          <td><div className="k">EVENT</div><div className="v">{e.name.toUpperCase()}</div></td>
          <td><div className="k">DATE</div><div className="v">&nbsp;</div></td>
          <td><div className="k">GROUP</div><div className="v">{GROUP[e.gender || ''] || ''}</div></td>
          <td><div className="k">TIME Hrs.</div><div className="v">&nbsp;</div></td>
          <td>
            <div className="k">HEAT No. / SEMI-FINAL / FINAL</div>
            <div className="v">{stage ? 'HEAT ___ / SEMI-FINAL / FINAL' : 'FINAL'}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Rows({ n, cols }: { n: number; cols: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i}>
          <td>{i + 1}</td>
          {Array.from({ length: cols - 1 }, (_, j) => <td key={j} />)}
        </tr>
      ))}
    </>
  );
}

function Sheet({ e, kind, rows }: { e: Ev; kind: Kind; rows: number }) {
  const title = kind === 'track' ? 'REPORT of REFEREE TRACK' : kind === 'field' ? '* DISTANCE SCORE CARD *' : `RESULT CARD  *  ${e.code.startsWith('PV') ? 'POLE VAULT' : 'HIGH JUMP'}`;
  const sigs = kind === 'track' ? ['REFEREE', 'CHIEF JUDGE'] : kind === 'field' ? ['REFEREE', 'CHIEF JUDGE'] : ['REFEREE', 'JUDGES'];
  return (
    <section className="bs-sheet">
      <div className="fed">ATHLETICS FEDERATION OF INDIA</div>
      <div className="meta">
        <div><b>Event Name:</b> {MEET.subtitle} ({MEET.name})</div>
        <div><b>Venue &amp; Date:</b> {MEET.venue} · {MEET.dates}</div>
        <div><b>Organised by:</b> Visvesvaraya Technological University, Belagavi</div>
      </div>
      <div className="banner">{title}</div>
      <Info e={e} stage={kind === 'track'} />

      {kind === 'track' && (
        <table className="bs-grid">
          <thead>
            <tr>
              <th style={{ width: 54 }}>LANE No.</th><th style={{ width: 70 }}>BIB No.</th><th>NAME of the ATHLETES</th>
              <th style={{ width: 110 }}>UNIT<div className="sub">College</div></th>
              <th style={{ width: 150 }}>PERFORMANCE<div className="sub">Time</div></th>
              <th style={{ width: 80 }}>POSITION</th>
              <th style={{ width: 170 }}>REMARKS<div className="sub">DQ rule</div></th>
            </tr>
          </thead>
          <tbody><Rows n={rows} cols={7} /></tbody>
        </table>
      )}

      {kind === 'field' && (
        <table className="bs-grid">
          <thead>
            <tr>
              <th colSpan={4} />
              <th colSpan={3}>TRIALS</th><th colSpan={2} /><th colSpan={2}>TRIALS</th><th colSpan={2} /><th colSpan={3} />
            </tr>
            <tr>
              <th>S.N.</th><th>NAME of the ATHLETES</th><th>BIB NUMBER</th><th>COLLEGE</th>
              <th>FIRST</th><th>SECOND</th><th>THIRD</th>
              <th>BEST OF THREE<div className="sub">TRIALS</div></th><th>POSITION<div className="sub">After Three Trials</div></th>
              <th>FOURTH</th><th>FIFTH</th>
              <th>BEST OF Five<div className="sub">TRIALS</div></th><th>POSITION<div className="sub">After Five Trials</div></th>
              <th>SIXTH</th><th>BEST OF ALL<div className="sub">TRIALS</div></th><th>FINAL<div className="sub">POSITION</div></th>
            </tr>
          </thead>
          <tbody><Rows n={rows} cols={16} /></tbody>
        </table>
      )}

      {kind === 'vertical' && (
        <table className="bs-grid">
          <thead>
            <tr>
              <th colSpan={4} />
              {Array.from({ length: 7 }, (_, i) => <th key={i} colSpan={3}>________ M.</th>)}
              <th colSpan={4} />
            </tr>
            <tr>
              <th>S.N.</th><th>NAME of the ATHLETES</th><th>BIB No.</th><th>COLLEGE</th>
              {Array.from({ length: 7 }, (_, i) => [1, 2, 3].map((n) => <th key={`${i}-${n}`}>{n}</th>))}
              <th>BEST<div className="sub">JUMP</div></th><th>TRIALS at<div className="sub">HEIGHT CLEARED</div></th>
              <th>TOTAL<div className="sub">FAILURE</div></th><th>FINAL<div className="sub">POSITION</div></th>
            </tr>
          </thead>
          <tbody><Rows n={rows} cols={4 + 21 + 4} /></tbody>
        </table>
      )}

      <div className="note">
        {kind === 'track'
          ? 'Write the status (finished / DNS / DNF / DQ) and time against each lane.'
          : kind === 'field'
            ? 'X foul · – pass · NM no valid mark. Trials 4–6 for the best 8 after three trials.'
            : 'LEGEND: O cleared · – pass · X failure. Three failures in a row and the athlete is out.'}
      </div>
      <div className="sigs">
        {sigs.map((s) => (
          <div className="sig" key={s}>
            <div className="sigt">{s}</div>
            <div className="line">NAME:</div>
            <div className="line">SIGNATURE:</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ScoreSheetsClient({ events }: { events: Ev[] }) {
  const usable = useMemo(() => events.map((e) => ({ e, kind: kindOf(e) })).filter((x): x is { e: Ev; kind: Kind } => x.kind !== null), [events]);
  const [selected, setSelected] = useState<Set<string>>(new Set(usable.map((x) => x.e.id)));
  const [copies, setCopies] = useState(1);
  const [trackRows, setTrackRows] = useState(8);
  const [fieldRows, setFieldRows] = useState(14);

  const chosen = usable.filter((x) => selected.has(x.e.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setKind = (k: Kind, on: boolean) => setSelected((s) => { const n = new Set(s); usable.filter((x) => x.kind === k).forEach((x) => (on ? n.add(x.e.id) : n.delete(x.e.id))); return n; });

  return (
    <div>
      <div className="bs-controls">
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Blank score sheets</h1>
        <p style={{ color: '#475569', margin: '0.3rem 0 1rem' }}>
          Empty referee score cards (same layout as the officials app) for paper backup. Pick events, press Print, and choose “Save as PDF” to download.
          Landscape A4, one sheet per page.
        </p>

        {(['track', 'field', 'vertical'] as Kind[]).map((k) => {
          const list = usable.filter((x) => x.kind === k);
          const all = list.every((x) => selected.has(x.e.id));
          return (
            <div key={k} style={{ marginBottom: '0.9rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {KIND_LABEL[k]} ({list.length}){' '}
                <button type="button" className="bs-link" onClick={() => setKind(k, !all)}>{all ? 'Clear' : 'Select all'}</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                {list.map(({ e }) => (
                  <label key={e.id} style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} /> {e.name}
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '1rem 0' }}>
          <label>Copies of each <input type="number" min={1} max={10} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(10, +e.target.value || 1)))} style={{ width: 56 }} /></label>
          <label>Track rows <input type="number" min={4} max={16} value={trackRows} onChange={(e) => setTrackRows(Math.max(4, Math.min(16, +e.target.value || 8)))} style={{ width: 56 }} /></label>
          <label>Field rows <input type="number" min={8} max={20} value={fieldRows} onChange={(e) => setFieldRows(Math.max(8, Math.min(20, +e.target.value || 14)))} style={{ width: 56 }} /></label>
          <button type="button" className="bs-print" disabled={!chosen.length} onClick={() => window.print()}>
            Print / save as PDF ({chosen.length * copies} sheet{chosen.length * copies === 1 ? '' : 's'})
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#64748b' }}>Decathlon and heptathlon are not included: they have no single score card.</p>
      </div>

      <div className="bs-print-area">
        {chosen.flatMap(({ e, kind }) =>
          Array.from({ length: copies }, (_, c) => <Sheet key={`${e.id}-${c}`} e={e} kind={kind} rows={kind === 'track' ? trackRows : fieldRows} />)
        )}
      </div>

      <style>{`
        .bs-link { background: none; border: 0; color: #2563eb; cursor: pointer; font-size: 12px; }
        .bs-print { background: #0f172a; color: #fff; border: 0; border-radius: 8px; padding: 0.55rem 1.1rem; font-weight: 700; cursor: pointer; }
        .bs-print:disabled { opacity: .5; cursor: default; }
        .bs-print-area { margin-top: 1.5rem; }
        .bs-sheet { background: #fff; color: #111; border: 1px solid #cbd5e1; padding: 14px; margin-bottom: 16px; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
        .bs-sheet .fed { text-align: center; font-size: 16px; font-weight: 900; letter-spacing: 1px; }
        .bs-sheet .meta { margin: 2px 0 4px; line-height: 1.35; }
        .bs-sheet .banner { border: 2px dashed #111; text-align: center; font-size: 17px; font-weight: 900; padding: 5px; margin-bottom: 6px; }
        .bs-sheet table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        .bs-sheet th, .bs-sheet td { border: 1px solid #374151; padding: 2px 3px; text-align: center; }
        .bs-sheet th { background: #f3f4f6; font-size: 9px; font-weight: 900; }
        .bs-sheet .sub { font-size: 8px; font-weight: 700; color: #4b5563; }
        .bs-sheet .bs-grid td { height: 24px; }
        .bs-info td { text-align: left !important; }
        .bs-info .k { font-size: 8.5px; font-weight: 800; color: #4b5563; }
        .bs-info .v { font-size: 12px; font-weight: 800; min-height: 15px; }
        .bs-sheet .note { font-size: 9.5px; color: #4b5563; margin: 2px 0 6px; }
        .bs-sheet .sigs { display: flex; gap: 10px; margin-top: 8px; }
        .bs-sheet .sig { flex: 1; border: 1.5px dashed #111; padding: 6px 10px; min-height: 80px; }
        .bs-sheet .sigt { text-align: center; font-weight: 900; font-size: 11px; }
        .bs-sheet .line { font-size: 11px; font-weight: 800; margin-top: 14px; }
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden; }
          .bs-print-area, .bs-print-area * { visibility: visible; }
          .bs-print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; }
          .bs-sheet { border: 0; margin: 0; padding: 0; page-break-after: always; break-after: page; }
          .bs-sheet:last-child { page-break-after: auto; break-after: auto; }
        }
      `}</style>
    </div>
  );
}
