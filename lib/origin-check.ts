import { headers } from 'next/headers';

/**
 * Reject mutating requests whose Origin/Host don't match. Defense-in-depth
 * over SameSite=Lax: in the rare case the admin cookie ends up scoped to
 * apex (ADMIN_HOST unset, future regression, etc.), Lax would still allow
 * a top-level form POST cross-site. This check refuses any PATCH/POST/DELETE
 * whose Origin doesn't match the Host header.
 *
 * Browsers send `sec-fetch-site` on every fetch. We require `same-origin`
 * or fall back to comparing Origin to Host. Server-to-server callers (no
 * Origin header) are allowed — auth still gates them.
 */
export async function requireSameOrigin(): Promise<void> {
  const h = await headers();
  const fetchSite = h.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') {
      return;
    }
    throw new Response(
      JSON.stringify({ error: 'cross-origin request denied' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const origin = h.get('origin');
  if (!origin) return;
  const host = h.get('host');
  if (!host) {
    throw new Response(
      JSON.stringify({ error: 'cross-origin request denied' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Response(
      JSON.stringify({ error: 'invalid origin' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (originHost.toLowerCase() !== host.toLowerCase()) {
    throw new Response(
      JSON.stringify({ error: 'cross-origin request denied' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
