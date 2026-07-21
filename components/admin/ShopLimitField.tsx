'use client';

import { useEffect, useState } from 'react';
import { isValidShopIndexLimit, SHOP_INDEX_LIMIT_MAX } from '@/lib/shop-limit';
import { mutationTimeout } from '@/lib/admin-fetch';

// The /shop cap, editable. 0 means no limit.
//
// Imports ONLY from lib/shop-limit, never lib/site-settings: the latter imports
// `pool`, and lib/db.ts calls createPool() at module scope, so a value import
// from a 'use client' component drags `pg` into the client bundle. That failure
// shows up only at `next build`, after typecheck and tests have both passed.

export function ShopLimitField({
  value,
  buyableCount,
  disabled,
  onSaved,
  onError,
}: {
  value: number;
  buyableCount: number;
  disabled?: boolean;
  onSaved: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(String(value)), [value]);

  async function save() {
    const n = Number(draft.trim());
    // Same predicate the server enforces, from one module, so the two cannot
    // drift. The empty-string guard matters: Number('') is 0, and 0 means
    // "no limit" here.
    if (draft.trim() === '' || !isValidShopIndexLimit(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n === value) return;
    setSaving(true);
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shop_index_limit', value: n }),
        signal: mutationTimeout(),
      });
      if (!r.ok) throw new Error(String(r.status));
      onSaved(n);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch {
      // Revert rather than leaving a number on screen that does not match what
      // /shop will actually do.
      setDraft(String(value));
      onError("Couldn't save the shop limit. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="wl-adm-ws-limit">
      {/* The control has to say WHAT it caps. "Show first" alone leaves an
          admin guessing whether it caps the shelf or the storefront. */}
      <label htmlFor="wl-shop-limit">Show the first</label>
      <input
        id="wl-shop-limit"
        type="number"
        min={0}
        max={SHOP_INDEX_LIMIT_MAX}
        value={draft}
        disabled={disabled || saving}
        aria-invalid={invalid || undefined}
        aria-describedby="wl-shop-limit-hint"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className="on-shop">on /shop</span>
      <span id="wl-shop-limit-hint" className="hint" role="status">
        {/* Always "all {buyableCount}", never "all {value}": with a limit of 50
            and 12 buyable pieces, "showing all 50 buyable" is wrong. */}
        {invalid
          ? `Whole number, 0 to ${SHOP_INDEX_LIMIT_MAX}`
          : saving
            ? 'saving…'
            : saved
              ? 'saved ✓ live within a minute'
              : value === 0
                ? `no limit, showing all ${buyableCount} buyable`
                : value >= buyableCount
                  ? `showing all ${buyableCount} buyable`
                  : `showing ${value} of ${buyableCount} buyable`}
      </span>
    </span>
  );
}
