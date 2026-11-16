/**
 * Instant feedback for every admin page: Next.js prefetches this fallback, so a click on the
 * nav swaps to this skeleton immediately while the page's data loads on the server.
 */
export default function AdminLoading() {
  const bar = (width: string, height = '0.9rem') => (
    <div className="admin-skeleton" style={{ width, height }} />
  );

  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '0.5rem 0' }}>
      <style>{`
        .admin-skeleton {
          border-radius: 8px;
          background: linear-gradient(90deg, #eef2f7 0%, #f8fafc 50%, #eef2f7 100%);
          background-size: 200% 100%;
          animation: admin-skeleton-shimmer 1.1s ease-in-out infinite;
        }
        @keyframes admin-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-skeleton { animation: none; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {bar('260px', '1.6rem')}
        {bar('420px')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', background: '#fff', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {bar('50%')}
            {bar('35%', '1.6rem')}
          </div>
        ))}
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', background: '#fff', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {bar('100%', '1.2rem')}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>{bar(`${92 - (i % 3) * 9}%`)}</div>
        ))}
      </div>
    </div>
  );
}
