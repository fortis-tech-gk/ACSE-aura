import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import ScoreSheetsClient from './ScoreSheetsClient';

export const dynamic = 'force-dynamic';

export default async function BlankScoreSheetsPage() {
  await requireAdmin();
  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, code, name, gender, category')
    .order('code', { ascending: true });
  return <ScoreSheetsClient events={events || []} />;
}
