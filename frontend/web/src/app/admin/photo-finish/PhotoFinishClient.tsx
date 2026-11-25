'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveHeatTimesAction, saveManualHeatAction, setPhotoFinishModeAction, type TimeRow } from '@/app/actions/photo-finish';
import { lifTimeToSeconds, parseResultsFile } from '@/lib/finishlynx';

export type PfEvent = { id: string; name: string; code: string; relay: boolean; maxLanes: number };
export type PfAthlete = { id: string; lane: number; bib: string; name: string; college: string; reported: boolean; saved: { status: string; time: string } | null };
export type PfHeat = { id: string; eventId: string; stage: string; heatNumber: number; status: string; athletes: PfAthlete[] };

const STAGES = [
  { v: 'HEATS', label: 'Heats' },
  { v: 'SEMI_FINAL', label: 'Semi-finals' },
  { v: 'FINAL', label: 'Final' },
];
const DONE = ['COMPLETED', 'OFFICIAL'];
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: 12, padding: '1.25rem' };
const input: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.85rem' };

type Msg = { ok: boolean; text: string } | null;

export default function PhotoFinishClient({ mode, events, heats }: { mode: 'APP' | 'MANUAL'; events: PfEvent[]; heats: PfHeat[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [eventId, setEventId] = useState(events[0]?.id || '');
  const [stage, setStage] = useState('HEATS');
  const [msg, setMsg] = useState<Msg>(null);
  const manual = mode === 'MANUAL';

  const event = events.find((e) => e.id === eventId);
  const roundHeats = useMemo(
    () => heats.filter((h) => h.eventId === eventId && h.stage === stage).sort((a, b) => a.heatNumber - b.heatNumber),
    [heats, eventId, stage]
  );

  function switchMode(next: 'APP' | 'MANUAL') {
    if (next === mode) return;
    const text =
      next === 'MANUAL'
        ? 'Switch to MANUAL mode?\n\nThe app will stop drawing heats for 100m, 200m, 400m, hurdles and relays (and stop building semi-finals / finals). The photo finish vendor makes the heats and you type lane + bib here. Heats already made stay as they are.'
        : 'Switch back to APP mode?\n\nThe app draws the heats from the call room again. Heats you typed in manual mode stay as they are.';
    if (!window.confirm(text)) return;
    start(async () => {
      const r = await setPhotoFinishModeAction(next);
      setMsg(r.success ? { ok: true, text: `Now in ${next} mode.` } : { ok: false, text: r.error || 'Could not switch.' });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="admin-page-header">
        <div className="admin-title-group">
          <h2>Photo Finish Desk</h2>
          <p>Heat sheets for the FinishLynx operator, and times back from him. Only 100m, 200m, 400m, hurdles and relays have heats.</p>
        </div>
      </div>

      {/* Mode switch */}
      <div style={{ ...card, marginBottom: '1.25rem', borderColor: manual ? '#f59e0b' : 'var(--border-color)', background: manual ? '#fffbeb' : '#fff' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
              Heat mode: <span style={{ color: manual ? '#b45309' : '#047857' }}>{manual ? 'MANUAL (vendor makes the heats)' : 'APP (the app makes the heats)'}</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 4 }}>
              {manual
                ? 'The call room still takes attendance. The vendor generates every heat, semi-final and final; you type lane + bib below. The app no longer draws or builds rounds for these events.'
                : 'Heats are drawn by the app from the call room roll call. Download the heat sheet below and give it to the vendor to import.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={pending} onClick={() => switchMode('APP')} className={`btn-admin ${!manual ? 'btn-admin-primary' : ''}`}>
              App mode
            </button>
            <button type="button" disabled={pending} onClick={() => switchMode('MANUAL')} className={`btn-admin ${manual ? 'btn-admin-primary' : ''}`}>
              Manual mode
            </button>
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ padding: '0.7rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.88rem', fontWeight: 600, background: msg.ok ? '#ecfdf5' : '#fee2e2', color: msg.ok ? '#065f46' : '#991b1b', border: `1px solid ${msg.ok ? '#a7f3d0' : '#fecdd3'}` }}>
          {msg.ok ? '✅' : '⚠️'} {msg.text}
        </div>
      )}

      {/* Pre-load */}
      <div style={{ ...card, marginBottom: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 320px', fontSize: '0.85rem', color: '#475569' }}>
          <strong style={{ color: '#0f172a' }}>Before the meet:</strong> give the vendor the athlete list (bib, name, college) once. Then a heat sheet only needs bib and lane, so it loads in about two minutes.
        </div>
        <a className="btn-admin" href="/admin/photo-finish/export?kind=people" download>
          ⬇ Athlete list (.ppl)
        </a>
      </div>

      {/* Event + round */}
      <div style={{ ...card, marginBottom: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ ...input, minWidth: 220 }} aria-label="Event">
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          {STAGES.map((s) => (
            <button key={s.v} type="button" onClick={() => setStage(s.v)} className={`btn-admin ${stage === s.v ? 'btn-admin-primary' : ''}`}>
              {s.label}
            </button>
          ))}
        </div>
        {roundHeats.length > 0 && (
          <a className="btn-admin" style={{ marginLeft: 'auto' }} href={`/admin/photo-finish/export?kind=startlist&eventId=${eventId}&stage=${stage}`} download>
            ⬇ Heat sheet, all heats (.evt)
          </a>
        )}
      </div>

      {event && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {roundHeats.length === 0 && (
            <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
              No {STAGES.find((s) => s.v === stage)?.label.toLowerCase()} for {event.name} yet.{' '}
              {manual ? 'Add the first heat below.' : 'The call room makes them when the roll call is prepared.'}
            </div>
          )}
          {roundHeats.map((h) => (
            <HeatCard key={`${h.id}-${h.athletes.map((a) => a.saved?.time).join()}`} heat={h} event={event} manual={manual} onMsg={setMsg} />
          ))}
          {manual && <ManualHeatForm key={`${eventId}-${stage}-${roundHeats.length}`} event={event} stage={stage} nextNumber={(roundHeats.at(-1)?.heatNumber || 0) + 1} onMsg={setMsg} />}
        </div>
      )}
    </div>
  );
}

/** Lane + bib typed from the vendor's heat sheet */
function ManualHeatForm({ event, stage, nextNumber, onMsg, initial }: { event: PfEvent; stage: string; nextNumber: number; onMsg: (m: Msg) => void; initial?: { heatNumber: number; text: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [num, setNum] = useState(initial?.heatNumber ?? nextNumber);
  const [text, setText] = useState(initial?.text ?? '');

  function save() {
    start(async () => {
      const r = await saveManualHeatAction(event.id, stage, num, text);
      if (r.success) {
        onMsg({ ok: true, text: r.removed ? `Heat ${num} removed.` : `Heat ${num} saved with ${r.entries} ${event.relay ? 'teams' : 'athletes'}. It is with the referee now.` });
        if (!initial) setText('');
        router.refresh();
      } else onMsg({ ok: false, text: r.error || 'Could not save.' });
    });
  }

  return (
    <div style={{ ...card, borderStyle: 'dashed' }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{initial ? `Edit lanes of heat ${initial.heatNumber}` : 'Add a heat from the vendor sheet'}</div>
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 8 }}>
        One line per lane: lane, then {event.relay ? 'the college code' : 'the bib number'}. For example <code>4 1207</code>. Everyone listed is counted as reported and the heat goes straight to the referee.
        {initial && ' Clear the box and save to remove the heat.'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <label style={{ fontSize: '0.8rem', color: '#475569' }}>
          Heat no.
          <br />
          <input type="number" min={1} max={30} value={num} disabled={!!initial} onChange={(e) => setNum(Number(e.target.value))} style={{ ...input, width: 70 }} />
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(10, Math.max(5, text.split('\n').length + 1))} placeholder={event.relay ? '1 ACS\n2 BMS\n3 RVCE' : '1 1201\n2 1207\n3 1340'} style={{ ...input, flex: '1 1 260px', fontFamily: 'monospace' }} />
        <button type="button" onClick={save} disabled={pending} className="btn-admin btn-admin-primary">
          {pending ? 'Saving…' : initial ? 'Save lanes' : 'Save heat'}
        </button>
      </div>
    </div>
  );
}

function HeatCard({ heat, event, manual, onMsg }: { heat: PfHeat; event: PfEvent; manual: boolean; onMsg: (m: Msg) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const done = DONE.includes(heat.status);
  const [vals, setVals] = useState<Record<string, { time: string; status: TimeRow['status'] }>>(() =>
    Object.fromEntries(heat.athletes.map((a) => [a.id, { time: a.saved?.status === 'FINISHED' ? a.saved.time : '', status: ((a.saved?.status as TimeRow['status']) || 'FINISHED') }]))
  );
  const [report, setReport] = useState<string[] | null>(null);
  const hasResults = heat.athletes.some((a) => a.saved);

  function importFile(file: File | undefined) {
    if (!file) return;
    file.text().then((text) => {
      const rows = parseResultsFile(text);
      const next = { ...vals };
      const problems: string[] = [];
      let matched = 0;
      const used = new Set<string>();
      for (const r of rows) {
        let a = r.bib ? heat.athletes.find((x) => x.bib.toUpperCase() === r.bib.toUpperCase()) : undefined;
        if (!a && !r.bib && r.lane != null) a = heat.athletes.find((x) => x.lane === r.lane);
        if (!a) {
          problems.push(`Line ${r.line}: ${r.bib ? `bib ${r.bib}` : `lane ${r.lane}`} is not in this heat — skipped.`);
          continue;
        }
        if (used.has(a.id)) { problems.push(`Line ${r.line}: ${a.name} appears twice — the last one is used.`); }
        used.add(a.id);
        if (r.lane != null && r.lane !== a.lane) problems.push(`Line ${r.line}: ${a.name} is in lane ${a.lane} here but lane ${r.lane} in the file.`);
        if (r.status === 'FINISHED' && lifTimeToSeconds(r.timeText) == null) {
          problems.push(`Line ${r.line}: "${r.timeText}" for ${a.name} is not a time — skipped.`);
          continue;
        }
        next[a.id] = { time: r.timeText, status: r.status };
        matched++;
      }
      const missing = heat.athletes.filter((a) => !used.has(a.id)).map((a) => `${a.name} (lane ${a.lane}) has no time in the file.`);
      setVals(next);
      setReport([`${matched} of ${heat.athletes.length} lines matched. Check the times below, then press Save times.`, ...problems, ...missing]);
    });
  }

  function save() {
    const rows: TimeRow[] = heat.athletes.map((a) => ({ heatAthleteId: a.id, timeText: vals[a.id]?.time || '', status: vals[a.id]?.status || 'FINISHED' }));
    start(async () => {
      const r = await saveHeatTimesAction(heat.id, rows);
      if (r.success) {
        onMsg({ ok: true, text: `Heat ${heat.heatNumber}: ${r.saved} saved${r.skipped ? `, ${r.skipped} left empty` : ''}. The referee presses Finish heat in the Officials app to publish and qualify.` });
        setReport(null);
        router.refresh();
      } else onMsg({ ok: false, text: r.error || 'Could not save.' });
    });
  }

  const lanesText = heat.athletes.map((a) => `${a.lane} ${a.bib}`).join('\n');

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ background: '#f8fafc', padding: '0.7rem 1rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
        <strong style={{ color: '#0f172a' }}>Heat {heat.heatNumber}</strong>
        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 999, background: done ? '#dcfce7' : '#fef3c7', color: done ? '#166534' : '#92400e', fontWeight: 700 }}>
          {done ? 'Finalized' : heat.status === 'ON_TRACK' ? 'With the referee' : heat.status}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <a className="btn-admin" href={`/admin/photo-finish/export?kind=startlist&heatId=${heat.id}`} download>⬇ Heat sheet (.lif)</a>
          {manual && !done && !hasResults && (
            <button type="button" className="btn-admin" onClick={() => setEditing((v) => !v)}>{editing ? 'Close' : 'Edit lanes'}</button>
          )}
        </span>
      </div>

      {editing && (
        <div style={{ padding: '0.75rem 1rem' }}>
          <ManualHeatForm event={event} stage={heat.stage} nextNumber={heat.heatNumber} initial={{ heatNumber: heat.heatNumber, text: lanesText }} onMsg={onMsg} />
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ color: '#64748b', textAlign: 'left' }}>
              <th style={{ padding: '0.45rem 0.8rem', width: 56 }}>Lane</th>
              <th style={{ padding: '0.45rem 0.8rem', width: 80 }}>{event.relay ? 'College' : 'Bib'}</th>
              <th style={{ padding: '0.45rem 0.8rem' }}>{event.relay ? 'Team' : 'Athlete'}</th>
              {!event.relay && <th style={{ padding: '0.45rem 0.8rem' }}>College</th>}
              <th style={{ padding: '0.45rem 0.8rem', width: 130 }}>Time</th>
              <th style={{ padding: '0.45rem 0.8rem', width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {heat.athletes.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.4rem 0.8rem', fontWeight: 800, color: '#2563eb' }}>{a.lane}</td>
                <td style={{ padding: '0.4rem 0.8rem', fontWeight: 700 }}>{a.bib || '—'}</td>
                <td style={{ padding: '0.4rem 0.8rem' }}>{a.name}{!a.reported && <span style={{ color: '#b91c1c', marginLeft: 6, fontSize: '0.75rem' }}>did not report</span>}</td>
                {!event.relay && <td style={{ padding: '0.4rem 0.8rem', color: '#64748b' }}>{a.college}</td>}
                <td style={{ padding: '0.3rem 0.8rem' }}>
                  <input
                    value={vals[a.id]?.time || ''}
                    disabled={done || !a.reported || vals[a.id]?.status !== 'FINISHED'}
                    onChange={(e) => setVals((v) => ({ ...v, [a.id]: { ...v[a.id], time: e.target.value } }))}
                    placeholder="10.42"
                    inputMode="decimal"
                    style={{ ...input, width: 100 }}
                    aria-label={`Time, lane ${a.lane}`}
                  />
                </td>
                <td style={{ padding: '0.3rem 0.8rem' }}>
                  <select
                    value={vals[a.id]?.status || 'FINISHED'}
                    disabled={done || !a.reported}
                    onChange={(e) => setVals((v) => ({ ...v, [a.id]: { time: '', status: e.target.value as TimeRow['status'] } }))}
                    style={input}
                    aria-label={`Status, lane ${a.lane}`}
                  >
                    <option value="FINISHED">Finished</option>
                    <option value="DNF">DNF</option>
                    <option value="DQ">DQ</option>
                    <option value="DNS">DNS</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report && (
        <ul style={{ margin: 0, padding: '0.6rem 1.5rem', fontSize: '0.8rem', color: '#92400e', background: '#fffbeb', borderTop: '1px solid #fde68a' }}>
          {report.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      {!done && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderTop: '1px solid #e2e8f0' }}>
          <label className="btn-admin" style={{ cursor: 'pointer' }}>
            ⬆ Import results file (.lif / .csv)
            <input type="file" accept=".lif,.csv,.txt,.evt" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" onClick={save} disabled={pending} className="btn-admin btn-admin-primary">{pending ? 'Saving…' : 'Save times'}</button>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Times to a thousandth are taken to the next longer hundredth.</span>
        </div>
      )}
    </div>
  );
}
