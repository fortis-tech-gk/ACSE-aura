'use client';

import { useEffect, useState } from 'react';

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

/**
 * Tabs left open across a deployment keep running the old JavaScript (old validation rules etc.).
 * This checks the server's build id every minute and whenever the tab regains focus, and shows a
 * "refresh" bar when a newer version exists. It never reloads by itself, so a half-filled form
 * is not lost.
 */
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!CURRENT) return;
    let stop = false;
    async function check() {
      try {
        const r = await fetch('/api/build-id', { cache: 'no-store' });
        const { id } = await r.json();
        if (!stop && id && id !== CURRENT) setStale(true);
      } catch {
        /* offline or transient: try again next time */
      }
    }
    const t = setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#b45309', color: '#fff', padding: '12px 16px',
        display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center',
        flexWrap: 'wrap', fontWeight: 600, fontSize: 14,
      }}
    >
      <span>A new version of this site is available. Please refresh to avoid errors.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ background: '#fff', color: '#b45309', border: 0, borderRadius: 6, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' }}
      >
        Refresh now
      </button>
    </div>
  );
}
