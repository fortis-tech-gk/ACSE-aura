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
  const { data: disciplines } = await supabaseAdmin.from('combined_disciplines').select('event_code, seq, code, name, day, kind').order('seq');
  return <ScoreSheetsClient events={events || []} disciplines={disciplines || []} />;
}
