import { requireAdmin } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { CertificatesView, type Placer } from './certificates-view';

export const metadata = {
  title: 'Official Certificates Generator — VTU SportsOS',
};

export default async function AdminCertificatesPage() {
  await requireAdmin();

  // Merit placers (a few hundred at most) and the accredited-athlete COUNT, read together. The
  // participation athletes themselves are read only when that tab is opened.
  const [{ data: placersRaw }, { count: participationCount }] = await Promise.all([
    supabaseAdmin
      .from('team_points')
      .select(`
        id,
        place,
        points,
        created_at,
        events(id, name, code, gender, category),
        colleges(id, name, code, district, region),
        profiles(id, sslc_name, usn, bid_number)
      `)
      .lte('place', 3)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('accreditation_status', 'ACCREDITED'),
  ]);

  const placers: Placer[] = ((placersRaw || []) as any[]).map((p) => ({
    id: p.id,
    place: p.place,
    points: p.points,
    created_at: p.created_at,
    events: Array.isArray(p.events) ? p.events[0] : p.events,
    colleges: Array.isArray(p.colleges) ? p.colleges[0] : p.colleges,
    profiles: Array.isArray(p.profiles) ? p.profiles[0] : p.profiles,
  }));

  return (
    <div className="container" id="admin-certificates-container">
      {/* Top Breadcrumb & Heading */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }} className="no-print">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
            <Link href="/admin/colleges" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontSize: '0.9rem' }}>
              Colleges
            </Link>
            <span style={{ color: 'var(--text-secondary)' }}>•</span>
            <Link href="/admin/schedule" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontSize: '0.9rem' }}>
              Schedule &amp; Heats
            </Link>
            <span style={{ color: 'var(--text-secondary)' }}>•</span>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>Official Certificates</span>
          </div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>
            Official Merit &amp; Participation Certificates
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            High-resolution printable landscape certificates with security QR verification and digital signature seals
          </p>
        </div>
      </div>

      <CertificatesView
        placers={placers}
        participationCount={participationCount || 0}
      />
    </div>
  );
}
