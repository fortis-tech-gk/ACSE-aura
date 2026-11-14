/**
 * Cached championship events catalogue (server-only, not a 'use server' module).
 *
 * The events table is the same for every squad and only changes when the Directorate edits the
 * programme, so one cached copy is shared across requests instead of re-reading it on every page
 * and server action. Per-squad data is never cached here.
 *
 * Invalidate after editing events with `revalidateTag(EVENTS_CACHE_TAG, { expire: 0 })`;
 * otherwise the copy refreshes itself every 10 minutes.
 */
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase';

export const EVENTS_CACHE_TAG = 'events-catalogue';

export interface CatalogueEvent {
  id: string;
  name: string;
  code: string;
  category: string | null;
  gender: string | null;
  start_type: string | null;
  has_rounds: boolean | null;
}

const loadEvents = unstable_cache(
  async (): Promise<CatalogueEvent[]> => {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id, name, code, category, gender, start_type, has_rounds')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as CatalogueEvent[];
  },
  ['events-catalogue-v1'],
  { tags: [EVENTS_CACHE_TAG], revalidate: 600 }
);

/** All events, ordered by name. Deduplicated within one request as well. */
export const getEventsCatalogue = cache(loadEvents);

/** Events whose code is in `codes` (case-insensitive). */
export async function getEventsByCodes(codes: string[]): Promise<CatalogueEvent[]> {
  const want = new Set(codes.map((c) => c.toUpperCase()));
  return (await getEventsCatalogue()).filter((e) => want.has(String(e.code || '').toUpperCase()));
}

/** Events whose id is in `ids`. */
export async function getEventsByIds(ids: string[]): Promise<CatalogueEvent[]> {
  const want = new Set(ids);
  return (await getEventsCatalogue()).filter((e) => want.has(e.id));
}
