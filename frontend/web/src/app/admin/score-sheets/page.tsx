import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import ScoreSheetsClient from './ScoreSheetsClient';

export const dynamic = 'force-dynamic';

export default async function BlankScoreSheetsPage() {
  await requireAdmin();
  const [{ data: events }, { data: disciplines }] = await Promise.all([
    supabaseAdmin.from('events').select('id, code, name, gender, category').order('code', { ascending: true }),
    supabaseAdmin.from('combined_disciplines').select('event_code, seq, code, name, day, kind').order('seq'),
  ]);
  return <ScoreSheetsClient events={events || []} disciplines={disciplines || []} />;
}
