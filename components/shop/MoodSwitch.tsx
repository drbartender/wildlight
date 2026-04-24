'use client';

import { useEffect, useState } from 'react';

// Mood switch — Bone (light) vs Ink (dark).
//
// Reads/writes html[data-mood]. An inline script in app/layout.tsx applies
// the stored preference before paint so returning visitors don't flash the
// wrong mode.

type Mood = 'bone' | 'ink';
const KEY = 'wl_mood';

export function MoodSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const [mood, setMood] = useState<Mood>('bone');

  useEffect(() => {
    const current = (document.documentElement.dataset.mood as Mood) || 'bone';
    setMood(current);
  }, []);

  function choose(next: Mood) {
    setMood(next);
    document.documentElement.dataset.mood = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable — session-only */
    }
  }

  const options: { key: Mood; label: string }[] = [
    { key: 'bone', label: 'Bone' },
    { key: 'ink', label: 'Ink' },
  ];

  return (
    <div
      className={`wl-mood-switch ${size === 'sm' ? 'sm' : ''}`}
      role="group"
      aria-label="Paper tone"
    >
      <span className="wl-mood-thumb" data-on={mood} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`wl-mood-opt ${mood === o.key ? 'on' : ''}`}
          aria-pressed={mood === o.key}
          onClick={() => choose(o.key)}
        >
          <span className={`wl-mood-dot ${o.key}`} aria-hidden="true" />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
