export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

/**
 * Stripe `return_url` (embedded checkout) lands here. We immediately 302 to
 * the canonical public-token URL so that:
 *   1. The session-id flavor of the order URL is never bookmarked or
 *      shared as a long-lived public access link, and
 *   2. The carrier tracking page on /orders/[token] only ever sees the
 *      public_token in the Referer header (not a Stripe session id).
 *
 * If the order row hasn't been written yet (webhook race), we render a
 * small processing page that meta-refreshes until the order materializes.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id || !/^cs_[a-zA-Z0-9_]{1,160}$/.test(id)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  const r = await pool.query<{ public_token: string }>(
    'SELECT public_token FROM orders WHERE stripe_session_id = $1 LIMIT 1',
    [id],
  );

  if (r.rowCount) {
    const url = new URL(`/orders/${r.rows[0].public_token}`, req.url);
    url.searchParams.set('success', '1');
    return NextResponse.redirect(url);
  }

  // This response is its own document — it doesn't go through app/layout.tsx
  // and doesn't load globals.css. So we inline the same `wl_mood` pre-paint
  // read from app/layout.tsx and define just enough CSS variables to honor
  // the visitor's bone/ink choice. Without this, an ink-mode user lands on
  // a hardcoded-bone page after paying — and stares at it on every 3s refresh
  // until the webhook materializes the order.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta http-equiv="refresh" content="3"/>
<title>Processing — Wildlight Imagery</title>
<script>(function(){try{var m=localStorage.getItem('wl_mood');document.documentElement.dataset.mood=(m==='ink'||m==='bone')?m:'bone';}catch(e){document.documentElement.dataset.mood='bone';}})();</script>
<style>
  :root { --paper:#f2ede1; --ink:#16130c; --muted:#6a6452; }
  [data-mood='ink'] { --paper:#141210; --ink:#f2ede1; --muted:#a9a390; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, serif; background: var(--paper); color: var(--ink); }
  main { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  h1 { font-weight: 400; }
  p { color: var(--muted); }
</style></head>
<body><main>
  <h1>Thank you &mdash; processing.</h1>
  <p>Your payment succeeded. We're finalizing your order &mdash; this usually takes a few seconds. This page will refresh automatically.</p>
  <p>A confirmation email is on its way with a link you can bookmark.</p>
</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
