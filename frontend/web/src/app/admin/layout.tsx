import Link from 'next/link';
import { requireFinance } from '@/lib/auth-guard';
import { logoutAction } from '@/app/actions/auth';
import { OfficialBanner } from '@/components/layout/OfficialBanner';
import '@/components/layout/Navbar.css';
import './admin.css';

export const metadata = {
  // Private portal: keep out of search results
  robots: { index: false, follow: false },
  title: 'VTU Athletics — Administrative Suite',
  description: 'Directorate Meet Administration, Roster Management, Payments & Accreditations',
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Finance Desk staff may enter the admin area for Payment Verification only: every other admin
  // page checks requireAdmin() itself.
  const session = await requireFinance();
  const isFinance = session.role === 'finance_desk';

  return (
    <div className="admin-shell">
      {/* 1 & 2. OFFICIAL TOP BANNER WITH Dr. ACSCE & VTU EMBLEMS */}
      <OfficialBanner portalBadge="DIRECTORATE ADMINISTRATIVE SUITE &bull; CENTRAL COMMAND" />

      {/* 3. SOLID DEEP NAVY ADMINISTRATIVE NAV BAR */}
      <nav className="univ-main-nav">
        <div className="univ-nav-inner">
          <div className="univ-nav-menu">
            {isFinance ? (
              <Link href="/admin/payments" prefetch={true} className="univ-nav-link">
                <span>💳 Payment Verification</span>
              </Link>
            ) : (
              <>
            <Link href="/admin" prefetch={true} className="univ-nav-link">
              <span>📊 Dashboard</span>
            </Link>
            <Link href="/admin/colleges" prefetch={true} className="univ-nav-link">
              <span>🏛️ Colleges &amp; Squads</span>
            </Link>
            <Link href="/admin/athletes" prefetch={true} className="univ-nav-link">
              <span>🏃 Athletes Management</span>
            </Link>
            <Link href="/admin/payments" prefetch={true} className="univ-nav-link">
              <span>💳 Payment Verification</span>
            </Link>
            <Link href="/admin/id-cards" prefetch={true} className="univ-nav-link">
              <span>🪪 ID Cards Studio</span>
            </Link>
            <Link href="/admin/heats" prefetch={true} className="univ-nav-link">
              <span>⏱️ Track Heats</span>
            </Link>
            <Link href="/admin/results" prefetch={true} className="univ-nav-link">
              <span>✏️ Results &amp; Corrections</span>
            </Link>
            <Link href="/admin/score-sheets" prefetch={true} className="univ-nav-link">
              <span>🖨️ Blank Score Sheets</span>
            </Link>
            <Link href="/admin/delegations" prefetch={true} className="univ-nav-link">
              <span>📋 Delegations</span>
            </Link>
            <Link href="/registration-desk" className="univ-nav-link">
              <span>✅ Registration Desk</span>
            </Link>
            <Link href="/admin/audit" prefetch={true} className="univ-nav-link">
              <span>📜 Audit Log</span>
            </Link>
              </>
            )}
          </div>

          <div className="univ-nav-auth">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#0f172a', fontSize: '0.825rem', fontWeight: 700, padding: '0.35rem 0.85rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <span>🛡️ {session.displayName || 'Meet Director'}</span>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="univ-btn-portal"
                style={{
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  fontWeight: 700,
                }}
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </nav>

      {/* Main Administrative Container - Fluid Full Width */}
      <main className="admin-container">
        {children}
      </main>
    </div>
  );
}
