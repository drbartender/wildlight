# Admin Spec 5c — Collections + Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the admin Collections page and the Login page per skin. Atelier = card grid + paper/serif Login. Darkroom = mono table + dark/teal Login.

**Architecture:** Dual-DOM per skin in the existing page components. CSS toggles by `[data-theme]`. No schema changes, no auth/session changes.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, plain CSS.

**Spec:** `docs/superpowers/specs/2026-04-24-admin-spec-5c-collections-and-login.md`

**Design invariant:** Atelier and Darkroom are independent visual languages. Collections Atelier = card grid; Darkroom = mono panel table. Login Atelier = paper + serif + green; Darkroom = mono + teal `W` square + status strip. Do not converge.

---

## File Structure

**Modify:**
- `app/admin/collections/page.tsx` — emit Atelier card grid (existing) + Darkroom table DOM; CSS toggles visibility.
- `app/admin/admin.css` — add Darkroom-specific rules for the collections table and login chrome.
- `app/login/page.tsx` — emit Atelier brand/form shell (existing) + Darkroom shell DOM.

**No new files.**

---

## Task 1: Collections page — Darkroom mono table DOM

**Files:**
- Modify: `app/admin/collections/page.tsx`
- Modify: `app/admin/admin.css`

- [ ] **Step 1: Add the Darkroom table JSX**

In `app/admin/collections/page.tsx`, find the existing card grid (`<div className="wl-adm-col-grid">`, approximately line 63). After its closing `</div>` but still inside the `{!loading && (…)}` branch, add a second DOM tree:

```tsx
            {/* Darkroom mono panel table */}
            <div className="wl-adm-panel wl-adm-col-darkroom">
              <div className="h">
                <span className="t">collections</span>
                <span className="c">[{rows.length}]</span>
                <span className="n">· drag to reorder</span>
                <button type="button" className="wl-adm-btn small primary" onClick={create}>
                  + new
                </button>
              </div>
              <table className="wl-adm-table mono">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>ord</th>
                    <th style={{ width: 60 }}>cover</th>
                    <th>title</th>
                    <th>tagline</th>
                    <th>slug</th>
                    <th className="right">artworks</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice()
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((c) => (
                      <tr key={c.id}>
                        <td className="muted">⋮⋮ {c.display_order}</td>
                        <td>
                          {c.cover_image_url && (
                            <img
                              src={c.cover_image_url}
                              alt=""
                              style={{ width: 36, height: 24, objectFit: 'cover', borderRadius: 2 }}
                            />
                          )}
                        </td>
                        <td>{c.title}</td>
                        <td>
                          <input
                            readOnly
                            defaultValue={c.tagline || ''}
                            className="wl-adm-col-tagline-inline"
                          />
                        </td>
                        <td className="muted">/{c.slug}</td>
                        <td className="right" style={{ color: 'var(--adm-green)' }}>
                          {c.n ?? 0}
                        </td>
                        <td className="right muted">
                          <button
                            type="button"
                            className="wl-adm-btn small"
                            onClick={() =>
                              alert('Inline edit coming in a later pass — use the Atelier card editor for now.')
                            }
                          >
                            edit
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="f">// inline-edit of tagline coming later</div>
            </div>
```

- [ ] **Step 2: Add CSS**

Append to `app/admin/admin.css`:

```css
/* Admin collections — Atelier card grid (default) vs Darkroom mono table */
.wl-adm-col-grid     { display: grid; }
.wl-adm-col-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-col-grid     { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-col-darkroom { display: block; }

.wl-adm-col-darkroom {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
}
.wl-adm-col-darkroom .h {
  padding: 8px 14px;
  border-bottom: 1px solid var(--adm-rule);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.wl-adm-col-darkroom .h .t { color: var(--adm-ink); }
.wl-adm-col-darkroom .h .c { color: var(--adm-muted); }
.wl-adm-col-darkroom .h .n { color: var(--adm-muted); }
.wl-adm-col-darkroom .h .wl-adm-btn { margin-left: auto; }
.wl-adm-col-darkroom .f {
  padding: 8px 14px;
  border-top: 1px solid var(--adm-rule);
  color: var(--adm-muted);
  font-size: 10px;
}
.wl-adm-col-tagline-inline {
  width: 100%;
  padding: 3px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--adm-ink-2);
  font-family: inherit;
  font-size: 11px;
}
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Reload `/admin/collections` in both skins. Atelier: card grid. Darkroom: mono table with drag-handle markers, inline-look tagline inputs, right-aligned teal count.

- [ ] **Step 4: Commit**

```bash
git add app/admin/collections/page.tsx app/admin/admin.css
git commit -m "admin: collections — Darkroom mono table alongside Atelier card grid"
```

---

## Task 2: Login — Darkroom shell

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `app/admin/admin.css`

- [ ] **Step 1: Restructure `LoginPage` to render both shells**

Replace the entire contents of `app/login/page.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError('Invalid credentials');
      return;
    }
    router.push('/admin');
    router.refresh();
  }

  const fields = (
    <>
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">Email</span>
        <input
          className="wl-adm-field-input"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@wildlight.co"
        />
      </label>
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">Password</span>
        <input
          className="wl-adm-field-input"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
    </>
  );

  return (
    <>
      {/* Atelier login */}
      <div className="wl-adm-login wl-adm-login-atelier">
        <div className="stack">
          <div className="brand">
            <div className="w">Wildlight</div>
            <div className="s">Imagery · Studio</div>
          </div>
          <form onSubmit={submit} className="card">
            {fields}
            {error && <p className="err">{error}</p>}
            <button
              type="submit"
              className="wl-adm-btn primary"
              disabled={loading}
              style={{ justifyContent: 'center', padding: '10px' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="foot">Trouble signing in? Contact Dallas.</div>
        </div>
      </div>

      {/* Darkroom login */}
      <div className="wl-adm-login wl-adm-login-darkroom">
        <div className="stack">
          <div className="brand">
            <div className="icon" aria-hidden="true">W</div>
            <div className="txt">
              <div className="w">wildlight</div>
              <div className="s">admin · v2.4</div>
            </div>
            <span className="health">● all systems ok</span>
          </div>
          <form onSubmit={submit} className="card">
            {fields}
            {error && <p className="err">{error}</p>}
            <button
              type="submit"
              className="wl-adm-btn primary"
              disabled={loading}
              style={{ justifyContent: 'center', padding: '7px', fontFamily: 'var(--f-mono), monospace' }}
            >
              {loading ? 'signing in…' : '→ sign in'}
            </button>
          </form>
          <div className="foot">// session expires after 7d inactivity</div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add Darkroom login CSS + visibility toggles**

Append to `app/admin/admin.css`:

```css
/* Login — Atelier default / Darkroom per theme */
.wl-adm-login-atelier  { display: flex; }
.wl-adm-login-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-login-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-login-darkroom { display: flex; }

.wl-adm-login-darkroom {
  height: 100%;
  align-items: center;
  justify-content: center;
  background: var(--adm-bg, var(--adm-paper));
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
}
.wl-adm-login-darkroom .stack { width: 340px; }
.wl-adm-login-darkroom .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.wl-adm-login-darkroom .brand .icon {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  background: var(--adm-green);
  color: var(--adm-paper);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}
.wl-adm-login-darkroom .brand .txt { display: flex; flex-direction: column; }
.wl-adm-login-darkroom .brand .txt .w {
  font-size: 13px;
  letter-spacing: 0.12em;
  color: var(--adm-ink);
}
.wl-adm-login-darkroom .brand .txt .s {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--adm-muted);
}
.wl-adm-login-darkroom .brand .health {
  margin-left: auto;
  font-size: 10px;
  color: var(--adm-green);
}
.wl-adm-login-darkroom .card {
  background: var(--adm-panel);
  border: 1px solid var(--adm-rule);
  border-radius: 4px;
  padding: 20px;
}
.wl-adm-login-darkroom .foot {
  margin-top: 14px;
  font-size: 10px;
  color: var(--adm-muted);
}
.wl-adm-login-darkroom .err {
  color: var(--adm-red);
  font-size: 11px;
}
```

The Darkroom shell uses the existing `.wl-adm-field` styles (scoped under `.wl-admin-surface`). `/login/layout.tsx` already imports `admin.css`, so no additional wiring.

- [ ] **Step 3: Verify `/login/layout.tsx` wraps in `.wl-admin-surface`**

Open `app/login/layout.tsx`. Confirm it wraps `children` with a `.wl-admin-surface[data-theme]` div. If not, the CSS visibility toggles won't fire. If it doesn't wrap, add it. Example snippet to verify:

```tsx
export default function LoginLayout({ children }: { children: ReactNode }) {
  const theme = readAdminTheme(); // from lib/admin-theme
  return (
    <div className="wl-admin-surface" data-theme={theme}>
      {children}
    </div>
  );
}
```

Make that change if `readAdminTheme()` / `.wl-admin-surface` isn't already being applied.

- [ ] **Step 4: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Visit `/login` in both skins (toggle by setting the cookie: `document.cookie = 'wl_admin_theme=dark'` in devtools and reload, or log in once, flip theme via the switch, then log out).

Expected: Atelier login shows serif `Wildlight` + paper card + green primary. Darkroom shows `W` square + mono wordmark + `all systems ok` strip + dark panel + teal `→ sign in` primary.

- [ ] **Step 5: Commit**

```bash
git add app/login/page.tsx app/login/layout.tsx app/admin/admin.css
git commit -m "admin: login — Darkroom shell alongside Atelier paper form"
```

---

## Task 3: Manual smoke + typecheck

**Files:** none.

- [ ] **Step 1: Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 2: Walk both pages in both skins**

```bash
npm run dev
```

- `/admin/collections` Atelier: card grid with on-blur persist on title/tagline/order.
- `/admin/collections` Darkroom: mono panel table. Inline tagline input looks editable but is read-only; `edit` button pops an alert explaining the compat deferral.
- `/login` Atelier: paper form with serif wordmark, working submit.
- `/login` Darkroom: dark form with mono wordmark + `W` square, working submit.

- [ ] **Step 3: Confirm clean**

```bash
git status
```

Expected: clean. 2 commits.

---

## Exit criteria

- `npm run typecheck` passes.
- `/admin/collections` renders a card grid in Atelier and a mono table in Darkroom.
- `/login` renders the paper+serif form in Atelier and the dark+mono form (with `W` square and `all systems ok` strip) in Darkroom.
- Login authentication still works on both skins.
- `/login` flips cleanly when the admin theme cookie changes.
- Deferred ⌘K real search is noted in a follow-up, not shipped here.
