'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const COOKIE = 'wl_admin_theme';
const LS_KEY = 'wildlight.admin.theme';

function writeCookie(v: Theme) {
  // 1-year cookie, available to SSR for no-flash theme rendering.
  document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function AdminThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Prefer the server-rendered surface attribute so we stay in sync with
    // whatever the SSR pass picked (cookie).
    const fromDom =
      (document.querySelector('.wl-admin-surface') as HTMLElement | null)
        ?.dataset.theme === 'dark'
        ? 'dark'
        : 'light';
    setTheme(fromDom);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    const surface = document.querySelector('.wl-admin-surface') as HTMLElement | null;
    if (surface) surface.dataset.theme = next;
    writeCookie(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      /* session-only */
    }
  }

  return (
    <div
      className="wl-adm-themeswitch"
      role="radiogroup"
      aria-label="Admin theme"
    >
      <button
        type="button"
        className={`wl-adm-themeswitch-opt ${theme === 'light' ? 'on' : ''}`}
        aria-pressed={theme === 'light'}
        onClick={() => choose('light')}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <span>Atelier</span>
      </button>
      <button
        type="button"
        className={`wl-adm-themeswitch-opt ${theme === 'dark' ? 'on' : ''}`}
        aria-pressed={theme === 'dark'}
        onClick={() => choose('dark')}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
        <span>Darkroom</span>
      </button>
    </div>
  );
}
