import { useMemo } from 'react';
import { useCachedFetch } from '../useCachedFetch';
import { useOfficialSession } from './session';

/**
 * A heat's data (works offline from the last saved copy) plus the entries for this heat that
 * are saved on the device but not yet sent — screens show those on top so nothing "disappears".
 */
export function useHeat<T>(heatId: string, path: string, pollMs = 15000) {
  const { token, queue } = useOfficialSession();
  const fetched = useCachedFetch<T>(`@aura/off-heat:${path}`, path, { token, enabled: !!token && !!heatId, pollMs });
  const pending = useMemo(
    () => queue.filter((q) => q.kind === 'op' && q.status === 'pending' && q.op?.heatId === heatId).map((q) => q.op!),
    [queue, heatId]
  );
  return { ...fetched, pending };
}
