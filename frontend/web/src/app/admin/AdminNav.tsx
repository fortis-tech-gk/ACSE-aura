'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Admin navigation with instant feedback: the current page is highlighted, and while a clicked
 * page is still loading its link shows a spinner and a progress bar runs along the top of the
 * window. Links use the default prefetch, which loads only the page skeleton (admin/loading.tsx)
 * ahead of time — so a click swaps to the skeleton at once instead of silently waiting.
 */

const ADMIN_LINKS: { href: string; label: string }[] = [
  { href: '/admin', label: '📊 Dashboard' },
  { href: '/admin/colleges', label: '🏛️ Colleges & Squads' },
  { href: '/admin/athletes', label: '🏃 Athletes Management' },
  { href: '/admin/payments', label: '💳 Payment Verification' },
  { href: '/admin/id-cards', label: '🪪 ID Cards Studio' },
  { href: '/admin/officials', label: '🎟️ Passes (Faculty · PED · Officials)' },
  { href: '/admin/heats', label: '⏱️ Track Heats' },
  { href: '/admin/photo-finish', label: '📸 Photo Finish' },
  { href: '/admin/results', label: '✏️ Results & Corrections' },
  { href: '/admin/score-sheets', label: '🖨️ Blank Score Sheets' },
  { href: '/admin/delegations', label: '📋 Delegations' },
  { href: '/registration-desk', label: '✅ Arrivals' },
  { href: '/admin/audit', label: '📜 Audit Log' },
];

const FINANCE_LINKS = [{ href: '/admin/payments', label: '💳 Payment Verification' }];

function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden className={`admin-nav-spinner${pending ? ' is-pending' : ''}`} />
      {pending && <span className="admin-nav-progress" role="progressbar" aria-label="Loading page" />}
    </>
  );
}

export default function AdminNav({ isFinance }: { isFinance: boolean }) {
  const pathname = usePathname();
  const links = isFinance ? FINANCE_LINKS : ADMIN_LINKS;
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="univ-nav-menu">
      <style>{`
        .admin-nav-spinner {
          width: 0.7rem; height: 0.7rem; flex-shrink: 0;
          border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
          opacity: 0; animation: admin-nav-spin 0.7s linear infinite;
          transition: opacity 0.15s;
        }
        .admin-nav-spinner.is-pending { opacity: 0.8; }
        .admin-nav-progress {
          position: fixed; top: 0; left: 0; z-index: 9999; height: 3px; width: 100%;
          background: linear-gradient(90deg, transparent, #2563eb, #60a5fa, transparent);
          background-size: 50% 100%; background-repeat: no-repeat;
          animation: admin-nav-bar 1s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes admin-nav-spin { to { transform: rotate(360deg); } }
        @keyframes admin-nav-bar { 0% { background-position: -50% 0; } 100% { background-position: 150% 0; } }
        @media (prefers-reduced-motion: reduce) {
          .admin-nav-spinner { animation: none; }
          .admin-nav-progress { animation: none; background: #2563eb; }
        }
      `}</style>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`univ-nav-link${isActive(l.href) ? ' active' : ''}`}
          aria-current={isActive(l.href) ? 'page' : undefined}
        >
          <span>{l.label}</span>
          <PendingHint />
        </Link>
      ))}
    </div>
  );
}
