/** Best mark of one heat entry (track time, field distance, vertical height) — shared by the athlete and PED views */

export type Attempt = { round?: number; attempt?: number; type?: string; mark?: number | null; height?: number; result?: string; wind?: number | null };

export function bestOf(entry: any, category: string): { value: number | null; status: string | null; reaction: number | null; wind: number | null; dq: string | null; attempts: Attempt[] } {
  if (category === 'field_vertical_jump') {
    const att: any[] = entry.vertical_jump_attempts || [];
    const cleared = att.filter((a) => a.result === 'O').map((a) => Number(a.bar_height_meters));
    return {
      value: cleared.length ? Math.max(...cleared) : null,
      status: att.length && !cleared.length ? 'NM' : null,
      reaction: null,
      wind: null,
      dq: null,
      attempts: att
        .map((a) => ({ height: Number(a.bar_height_meters), attempt: a.attempt_number, result: a.result }))
        .sort((x, y) => x.height! - y.height! || x.attempt! - y.attempt!),
    };
  }
  if (category.startsWith('field_')) {
    const att: any[] = entry.field_attempts || [];
    const valid = att.filter((a) => a.attempt_type === 'VALID' && a.mark_meters != null).map((a) => Number(a.mark_meters));
    return {
      value: valid.length ? Math.max(...valid) : null,
      status: att.length && !valid.length ? 'NM' : null,
      reaction: null,
      wind: null,
      dq: null,
      attempts: att
        .map((a) => ({ round: a.round_number, type: a.attempt_type, mark: a.mark_meters != null ? Number(a.mark_meters) : null, wind: a.wind_reading != null ? Number(a.wind_reading) : null }))
        .sort((x, y) => x.round! - y.round!),
    };
  }
  // Track / relay / road: one result row
  const tr = Array.isArray(entry.track_results) ? entry.track_results[0] : entry.track_results;
  if (!tr) return { value: null, status: null, reaction: null, wind: null, dq: null, attempts: [] };
  return {
    value: tr.status === 'FINISHED' && tr.time_seconds != null ? Number(tr.time_seconds) : null,
    status: tr.status === 'FINISHED' ? null : tr.status,
    reaction: tr.reaction_time_ms ?? null,
    wind: tr.wind_reading != null ? Number(tr.wind_reading) : null,
    dq: tr.dq_rule || null,
    attempts: [],
  };
}
