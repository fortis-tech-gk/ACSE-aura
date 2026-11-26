'use client';

import { useEffect } from 'react';

/** localStorage key written by the login page: other tabs of this browser react to it immediately */
export const SQUAD_LOGIN_EVENT_KEY = 'vtu-squad-login-at';

const CHECK_EVERY_MS = 10_000;

/**
 * One browser holds ONE login cookie. If the PED logs in as the Women's squad in a second tab, a
 * Men's tab that is still open would otherwise keep showing Men's forms while every action runs as
 * Women. This renders nothing; it sends the tab to the login page as soon as the cookie no longer
 * belongs to the squad the page was opened for (new login as another squad, or logged out).
 */
export default function SquadSessionWatcher({ squadId }: { squadId: string }) {
  useEffect(() => {
    let redirecting = false;

    async function check() {
      if (redirecting) return;
      try {
        const res = await fetch('/api/squad-session', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return; // server hiccup: never kick anyone out on an error
        const data = (await res.json()) as { squadId: string | null };
        if (data.squadId !== squadId) {
          redirecting = true;
          window.location.replace('/login/squad?reason=session-changed');
        }
      } catch {
        // offline: try again on the next tick
      }
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === SQUAD_LOGIN_EVENT_KEY) void check();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [squadId]);

  return null;
}
