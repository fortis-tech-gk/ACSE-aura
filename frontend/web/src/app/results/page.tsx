import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { Navbar } from '@/components/layout/Navbar';
import AutoRefresh from './AutoRefresh';
import './results.css';

/**
 * Public live results — every heat / flight a referee has started or finalized in the AURA
 * Officials app, plus the championship standings. Refreshes itself every 15 seconds.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Live Results · Dr. ACS-AURA 2026',
  description: 'Live results and championship standings — 28th VTU State Level Inter-Collegiate Athletic Meet.',
};

const STAGE: Record<string, string> = { HEATS: 'Heat', SEMI_FINAL: 'Semi-final', FINAL: 'Final', QUALIFYING: 'Qualifying' };
const STAGE_ORDER: Record<string, number> = { FINAL: 0, SEMI_FINAL: 1, HEATS: 2, QUALIFYING: 3 };
const GENDER: Record<string, string> = { men: 'Men', women: 'Women', mixed: 'Mixed' };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

function showTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(2);
  return m ? `${m}:${rest.padStart(5, '0')}` : rest;
}

type Row = { place: number | null; bib: number | null; name: string; college: string; mark: string; note: string };

/** Ranked rows for one heat: times ascending, field best valid mark, vertical best height cleared */
function rankHeat(h: any): Row[] {
  const ev = one<any>(h.events) || {};
  const field = String(ev.category || '').startsWith('field');
  const vertical = ev.category === 'field_vertical_jump';
  const rows = (h.heat_athletes || []).map((a: any) => {
    const p = one<any>(a.profiles);
    const team = one<any>(a.relay_teams);
    const college = one<any>(one<any>((p || team)?.squads)?.colleges);
    const base = { bib: p?.bid_number ?? null, name: p?.sslc_name || (college ? `${college.code} relay team` : 'Relay team'), college: college?.code || '' };
    if (vertical) {
      const cleared = (a.vertical_jump_attempts || []).filter((x: any) => x.result === 'O').map((x: any) => Number(x.bar_height_meters));
      const best = cleared.length ? Math.max(...cleared) : null;
      return { ...base, value: best, sortDesc: true, mark: best != null ? `${best.toFixed(2)} m` : (a.vertical_jump_attempts || []).length ? 'NM' : '', note: '' };
    }
    if (field) {
      const marks = (a.field_attempts || []).filter((x: any) => x.attempt_type === 'VALID' && x.mark_meters != null).map((x: any) => Number(x.mark_meters));
      const best = marks.length ? Math.max(...marks) : null;
      return { ...base, value: best, sortDesc: true, mark: best != null ? `${best.toFixed(2)} m` : (a.field_attempts || []).length ? 'NM' : '', note: '' };
    }
    const tr = one<any>(a.track_results);
    const finished = tr?.status === 'FINISHED' && tr.time_seconds != null;
    return { ...base, value: finished ? Number(tr.time_seconds) : null, sortDesc: false, mark: finished ? showTime(Number(tr.time_seconds)) : tr?.status || '', note: tr?.status === 'DQ' ? tr.dq_rule || '' : '' };
  });
  const ranked = rows.filter((r: any) => r.value != null).sort((x: any, y: any) => (x.sortDesc ? y.value - x.value : x.value - y.value));
  const out: Row[] = ranked.map((r: any, i: number) => ({ ...r, place: i > 0 && ranked[i - 1].value === r.value ? null : i + 1 }));
  // Shared places keep the place of the first in the tie
  out.forEach((r, i) => { if (r.place == null && i > 0) r.place = out[i - 1].place; });
  return [...out, ...rows.filter((r: any) => r.value == null).map((r: any) => ({ ...r, place: null }))];
}

async function load() {
  const [heatsRes, standingsRes] = await Promise.all([
    supabaseAdmin
      .from('heats')
      .select(
        `id, stage, heat_number, status, wind_reading,
         events(id, name, code, gender, category),
         heat_athletes(lane_number,
           profiles(sslc_name, bid_number, squads(colleges(code, name))),
           relay_teams(squads(colleges(code, name))),
           track_results(time_seconds, status, dq_rule),
           field_attempts(attempt_type, mark_meters),
           vertical_jump_attempts(bar_height_meters, result))`
      )
      .in('status', ['IN_PROGRESS', 'ON_TRACK', 'COMPLETED', 'OFFICIAL']),
    supabaseAdmin.rpc('get_championship_standings'),
  ]);
  return { heats: heatsRes.data || [], standings: (standingsRes.data || {}) as any, error: heatsRes.error?.message || null };
}

export default async function ResultsPage() {
  const { heats, standings, error } = await load();

  // Group heats by event; finals first, then by event name
  const byEvent = new Map<string, { ev: any; heats: any[] }>();
  for (const h of heats as any[]) {
    const ev = one<any>(h.events);
    if (!ev) continue;
    const g = byEvent.get(ev.id) || { ev, heats: [] };
    g.heats.push(h);
    byEvent.set(ev.id, g);
  }
  const events = [...byEvent.values()]
    .map((g) => ({ ...g, heats: g.heats.sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) || a.heat_number - b.heat_number) }))
    .sort((a, b) => (STAGE_ORDER[a.heats[0].stage] ?? 9) - (STAGE_ORDER[b.heats[0].stage] ?? 9) || a.ev.name.localeCompare(b.ev.name));

  const tables: { key: string; title: string }[] = [
    { key: 'combined', title: 'Overall Championship' },
    { key: 'mens', title: "Men's Team" },
    { key: 'womens', title: "Women's Team" },
  ];

  return (
    <div className="results-page">
      <Navbar />
      <AutoRefresh seconds={15} />
      <main className="results-main">
        <header className="results-head">
          <p className="results-kicker">28th VTU State Level Inter-Collegiate Athletic Meet · Dr. ACS-AURA 2026</p>
          <h1>Live Results</h1>
          <p className="results-sub">Published by the referees the moment each heat is finalized. This page updates every 15 seconds.</p>
        </header>

        {error && <p className="results-empty">Results are not available right now. Please try again shortly.</p>}

        <section className="results-standings" aria-label="Championship standings">
          {tables.map((t) => {
            const rows = (standings?.[t.key] || []) as any[];
            return (
              <div key={t.key} className="results-card">
                <h2>{t.title}</h2>
                {rows.length ? (
                  <table className="results-table">
                    <thead>
                      <tr><th>#</th><th>College</th><th title="Gold">🥇</th><th title="Silver">🥈</th><th title="Bronze">🥉</th><th>Pts</th></tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 10).map((r) => (
                        <tr key={r.college_id}>
                          <td>{r.rank}</td>
                          <td className="results-left" title={r.college_name}>{r.college_code}</td>
                          <td>{r.golds}</td><td>{r.silvers}</td><td>{r.bronzes}</td>
                          <td className="results-strong">{Number(r.total_points)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="results-empty">No points yet.</p>
                )}
              </div>
            );
          })}
        </section>

        {events.length === 0 && !error && <p className="results-empty">No results yet — they appear here as soon as the first heat is run.</p>}

        <section className="results-events">
          {events.map(({ ev, heats: hs }) => (
            <article key={ev.id} className="results-card results-event">
              <h2>
                {ev.name} {GENDER[ev.gender] ? <span className="results-tag">{GENDER[ev.gender]}</span> : null}
              </h2>
              {hs.map((h) => {
                const rows = rankHeat(h);
                const live = !['COMPLETED', 'OFFICIAL'].includes(h.status);
                return (
                  <div key={h.id} className="results-heat">
                    <h3>
                      {STAGE[h.stage] || h.stage}
                      {!(h.stage === 'FINAL' && h.heat_number === 1 && hs.filter((x) => x.stage === 'FINAL').length === 1) ? ` ${h.heat_number}` : ''}
                      {h.wind_reading != null ? <span className="results-wind"> · wind {Number(h.wind_reading) > 0 ? '+' : ''}{Number(h.wind_reading).toFixed(1)}</span> : null}
                      <span className={live ? 'results-live' : 'results-final'}>{live ? 'LIVE' : 'FINAL RESULT'}</span>
                    </h3>
                    <table className="results-table">
                      <thead>
                        <tr><th>Pos</th><th>Bib</th><th className="results-left">Name</th><th>College</th><th>Result</th></tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={h.stage === 'FINAL' && !live && r.place && r.place <= 3 ? `results-medal results-medal-${r.place}` : ''}>
                            <td>{r.place ?? '—'}</td>
                            <td>{r.bib ?? ''}</td>
                            <td className="results-left">{r.name}</td>
                            <td>{r.college}</td>
                            <td className="results-strong" title={r.note || undefined}>{r.mark}{r.note ? ` (${r.note})` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </article>
          ))}
        </section>

        <p className="results-foot"><Link href="/">← Back to the championship home page</Link></p>
      </main>
    </div>
  );
}
