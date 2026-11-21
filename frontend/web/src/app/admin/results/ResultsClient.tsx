'use client';

import { useMemo, useState } from 'react';
import {
  correctCombinedMarkAction,
  correctTrackResultAction,
  getHeatResultsAction,
  listFinishedHeatsAction,
  reopenHeatAction,
  type FinishedHeat,
} from '@/app/actions/results-admin';
import { showTime } from '@/lib/result-marks';

const STAGE: Record<string, string> = { HEATS: 'Heat', SEMI_FINAL: 'Semi-final', FINAL: 'Final', QUALIFYING: 'Qualifying' };
const GENDER: Record<string, string> = { men: 'Men', women: 'Women', mixed: 'Mixed' };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type Detail = any;

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem 1.2rem', marginBottom: '0.8rem' };
const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '0.45rem 0.9rem', fontWeight: 700, cursor: 'pointer', background: '#0f172a', color: '#fff' };
const btnLight: React.CSSProperties = { ...btn, background: '#e2e8f0', color: '#0f172a' };
const input: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: 14 };

export default function ResultsClient({ initialHeats, loadError }: { initialHeats: FinishedHeat[]; loadError: string | null }) {
  const [heats, setHeats] = useState(initialHeats);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return heats.filter((h) => !s || `${h.events?.name} ${h.events?.code} ${STAGE[h.stage] || h.stage}`.toLowerCase().includes(s));
  }, [heats, q]);

  async function open(id: string) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    setDetail(null);
    setMsg(null);
    const d = await getHeatResultsAction(id);
    if ((d as any).error) setMsg({ ok: false, text: (d as any).error });
    else setDetail(d);
  }
  async function refreshDetail(id: string) {
    const d = await getHeatResultsAction(id);
    if (!(d as any).error) setDetail(d);
  }

  async function reopen(h: FinishedHeat) {
    if (!window.confirm(`Reopen ${h.events?.name} · ${STAGE[h.stage] || h.stage} ${h.heat_number}?\n\nThe referee can then correct the results in the Officials app and must finish the heat again. Places and points are recalculated when it is finished again.`)) return;
    setBusy(true);
    const r = await reopenHeatAction(h.id, reason);
    setBusy(false);
    if (r.success) {
      setMsg({ ok: true, text: 'Heat reopened. The referee can now correct it in the Officials app and finish it again.' });
      const list = await listFinishedHeatsAction();
      setHeats(list.heats);
      setOpenId(null);
    } else setMsg({ ok: false, text: r.error || 'Could not reopen.' });
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Results &amp; corrections</h1>
      <p style={{ color: '#475569', margin: '0.3rem 0 1rem' }}>
        Fix a wrong result after a referee has finished a heat. <b>Reopen</b> hands the heat back to the referee&apos;s tablet. A <b>track final</b> time or a
        <b> decathlon / heptathlon</b> mark can also be corrected right here. Every change needs a reason and is written to the Audit Log.
      </p>

      {loadError && <div style={{ ...card, background: '#fef2f2', borderColor: '#fecaca' }}>Could not load the heats: {loadError}</div>}
      {msg && <div style={{ ...card, background: msg.ok ? '#f0fdf4' : '#fef2f2', borderColor: msg.ok ? '#bbf7d0' : '#fecaca', color: msg.ok ? '#166534' : '#991b1b' }}>{msg.text}</div>}

      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search event, e.g. 100m, decathlon" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, minWidth: 260 }} />
        <input placeholder="Reason for the change (required, goes in the Audit Log)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...input, flex: 1, minWidth: 280 }} />
      </div>

      {!shown.length && !loadError && <div style={card}>No finished heats yet.</div>}

      {shown.map((h) => (
        <div key={h.id} style={card}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b>{h.events?.name}</b> <span style={{ color: '#64748b' }}>{GENDER[h.events?.gender || ''] || ''}</span>
              <div style={{ color: '#475569', fontSize: 13 }}>{STAGE[h.stage] || h.stage}{!(h.stage === 'FINAL' && h.heat_number === 1) ? ` ${h.heat_number}` : ''} · {h.status === 'COMPLETED' ? 'Results done' : h.status}</div>
            </div>
            <button style={btnLight} onClick={() => open(h.id)}>{openId === h.id ? 'Close' : 'View / correct'}</button>
            <button style={btn} disabled={busy} onClick={() => reopen(h)}>Reopen heat</button>
          </div>
          {openId === h.id && (
            <div style={{ marginTop: 12 }}>
              {!detail ? <p>Loading…</p> : <HeatDetail d={detail} reason={reason} onSaved={() => refreshDetail(h.id)} setMsg={setMsg} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function who(e: any): string {
  const p = one<any>(e.profiles);
  if (p) return `${p.bid_number != null ? `#${p.bid_number} ` : ''}${p.sslc_name} (${one<any>(one<any>(p.squads)?.colleges)?.code || ''})`;
  const t = one<any>(e.relay_teams);
  return `${one<any>(one<any>(t?.squads)?.colleges)?.code || ''} relay team`;
}

function HeatDetail({ d, reason, onSaved, setMsg }: { d: Detail; reason: string; onSaved: () => void; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const cat: string = d.heat.events?.category || '';
  const field = cat.startsWith('field');
  const combined = cat === 'combined';
  const final = d.heat.stage === 'FINAL';

  if (combined) return <CombinedDetail d={d} reason={reason} onSaved={onSaved} setMsg={setMsg} />;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead><tr style={{ textAlign: 'left', color: '#64748b' }}><th>Lane</th><th>Athlete / team</th><th>Result</th>{!field && final && <th>Correct</th>}</tr></thead>
      <tbody>
        {d.entries.map((e: any) => (
          <tr key={e.id} style={{ borderTop: '1px solid #e2e8f0' }}>
            <td style={{ padding: '6px 4px' }}>{e.lane_number}</td>
            <td>{who(e)}</td>
            <td><b>{resultText(e, cat)}</b></td>
            {!field && final && <td><TrackFix e={e} reason={reason} onSaved={onSaved} setMsg={setMsg} /></td>}
          </tr>
        ))}
        <tr><td colSpan={4} style={{ color: '#64748b', paddingTop: 10, fontSize: 13 }}>
          {field ? 'Throws, jumps and high jump / pole vault: use "Reopen heat" so the referee corrects the attempts in the app.' : final ? '' : 'Earlier rounds feed the next round: use "Reopen heat" so the referee corrects it and the next round is rebuilt.'}
        </td></tr>
      </tbody>
    </table>
  );
}

function resultText(e: any, cat: string): string {
  if (cat === 'field_vertical_jump') {
    const cleared = (e.vertical_jump_attempts || []).filter((x: any) => x.result === 'O').map((x: any) => Number(x.bar_height_meters));
    return cleared.length ? `${Math.max(...cleared).toFixed(2)} m` : (e.vertical_jump_attempts || []).length ? 'NM' : '—';
  }
  if (cat.startsWith('field')) {
    const marks = (e.field_attempts || []).filter((x: any) => x.attempt_type === 'VALID' && x.mark_meters != null).map((x: any) => Number(x.mark_meters));
    return marks.length ? `${Math.max(...marks).toFixed(2)} m` : (e.field_attempts || []).length ? 'NM' : '—';
  }
  const tr = one<any>(e.track_results);
  if (!tr) return e.call_room_reported ? '—' : 'DNS';
  return tr.status === 'FINISHED' ? showTime(Number(tr.time_seconds)) : tr.status;
}

function TrackFix({ e, reason, onSaved, setMsg }: { e: any; reason: string; onSaved: () => void; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const tr = one<any>(e.track_results);
  const [time, setTime] = useState(tr?.time_seconds != null ? showTime(Number(tr.time_seconds)) : '');
  const [status, setStatus] = useState<'FINISHED' | 'DNF' | 'DQ' | 'DNS'>(tr?.status || 'FINISHED');
  const [dq, setDq] = useState(tr?.dq_rule || '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await correctTrackResultAction(e.id, time, status, dq, reason);
    setBusy(false);
    setMsg(r.success ? { ok: true, text: `Saved for ${who(e)}. Places and points are recalculated.` } : { ok: false, text: r.error || 'Not saved.' });
    if (r.success) onSaved();
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={status} onChange={(x) => setStatus(x.target.value as any)} style={input}>
        {['FINISHED', 'DNF', 'DQ', 'DNS'].map((s) => <option key={s}>{s}</option>)}
      </select>
      {status === 'FINISHED' && <input value={time} onChange={(x) => setTime(x.target.value)} placeholder="10.42" style={{ ...input, width: 90 }} />}
      {status === 'DQ' && <input value={dq} onChange={(x) => setDq(x.target.value)} placeholder="rule" style={{ ...input, width: 90 }} />}
      <button style={btn} disabled={busy} onClick={save}>Save</button>
    </span>
  );
}

function CombinedDetail({ d, reason, onSaved, setMsg }: { d: Detail; reason: string; onSaved: () => void; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const byId = new Map<string, any>((d.standings || []).map((s: any) => [s.heat_athlete_id, s]));
  const entries = [...d.entries].sort((a: any, b: any) => (byId.get(a.id)?.rank ?? 999) - (byId.get(b.id)?.rank ?? 999));
  return (
    <div>
      {entries.map((e: any) => {
        const st = byId.get(e.id);
        return (
          <details key={e.id} style={{ borderTop: '1px solid #e2e8f0', padding: '6px 0' }}>
            <summary style={{ cursor: 'pointer' }}>
              <b>{st?.classified ? `${st.rank}.` : 'NC'}</b> {who(e)} — <b>{st ? st.total : 0} pts</b> ({st?.done ?? 0}/{d.disciplines.length} disciplines)
            </summary>
            <div style={{ display: 'grid', gap: 6, margin: '8px 0 4px' }}>
              {d.disciplines.map((disc: any) => <CombinedFix key={disc.code} e={e} disc={disc} reason={reason} onSaved={onSaved} setMsg={setMsg} />)}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function CombinedFix({ e, disc, reason, onSaved, setMsg }: { e: any; disc: any; reason: string; onSaved: () => void; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const r = (e.combined_results || []).find((x: any) => x.discipline === disc.code);
  const initial = r?.mark != null ? (disc.kind === 'track' ? showTime(Number(r.mark)) : Number(r.mark).toFixed(2)) : '';
  const [mark, setMark] = useState(initial);
  const [status, setStatus] = useState<'FINISHED' | 'NM' | 'DNF' | 'DQ' | 'DNS'>(r?.status || 'FINISHED');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await correctCombinedMarkAction(e.id, disc.code, mark, status, reason);
    setBusy(false);
    setMsg(res.success ? { ok: true, text: `${disc.name} saved for ${who(e)}: ${res.points ?? 0} points.` } : { ok: false, text: res.error || 'Not saved.' });
    if (res.success) onSaved();
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ width: 120 }}>{disc.name} <span style={{ color: '#64748b', fontSize: 12 }}>day {disc.day}</span></span>
      <select value={status} onChange={(x) => setStatus(x.target.value as any)} style={input}>
        {['FINISHED', ...(disc.kind === 'field' ? ['NM'] : []), 'DNF', 'DQ', 'DNS'].map((s) => <option key={s}>{s}</option>)}
      </select>
      {status === 'FINISHED' && <input value={mark} onChange={(x) => setMark(x.target.value)} placeholder={disc.kind === 'track' ? 'time' : 'metres'} style={{ ...input, width: 100 }} />}
      <span style={{ width: 70, color: '#1d4ed8', fontWeight: 700 }}>{r ? `${r.points} pts` : ''}</span>
      <button style={btnLight} disabled={busy} onClick={save}>Save</button>
    </div>
  );
}
