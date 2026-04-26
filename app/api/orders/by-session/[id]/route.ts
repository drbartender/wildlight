export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

/**
 * Stripe `success_url` lands here. We immediately 302 to the canonical
 * public-token URL so that:
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

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta http-equiv="refresh" content="3"/>
<title>Processing — Wildlight Imagery</title>
<style>
  body { font-family: Georgia, serif; background: #faf9f7; color: #1a1a1a;
         margin: 0; padding: 0; }
  main { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  h1 { font-weight: 400; }
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
