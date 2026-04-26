export const runtime = 'nodejs';
import crypto from 'node:crypto';
import { pool } from '@/lib/db';

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${title} — Wildlight Imagery</title>
<style>
  body { font-family: Georgia, serif; background: #faf9f7; color: #1a1a1a;
         margin: 0; padding: 0; }
  main { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  h1 { font-weight: 400; }
  a { color: #2a3a2a; }
</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id') || '0');
  const token = url.searchParams.get('t') || '';
  if (!Number.isFinite(id) || id <= 0 || !token) {
    return page('Invalid link', '<p>This confirmation link is malformed.</p>', 400);
  }

  const r = await pool.query<{
    confirm_token: string | null;
    confirmed_at: string | null;
  }>('SELECT confirm_token, confirmed_at FROM subscribers WHERE id = $1', [id]);
  if (!r.rowCount) {
    return page(
      'Invalid link',
      '<p>This confirmation link is expired or invalid.</p>',
      400,
    );
  }
  if (r.rows[0].confirmed_at) {
    return page(
      'Already subscribed',
      '<p>This email is already confirmed. You can close this window.</p>',
    );
  }

  const stored = r.rows[0].confirm_token;
  if (!stored) {
    return page(
      'Invalid link',
      '<p>This confirmation link is expired or invalid.</p>',
      400,
    );
  }
  // The DB stores SHA-256(token); the email carries the plaintext. Hash
  // the incoming token and compare hash↔hash so a leaked subscribers
  // table can't be replayed against /confirm.
  const incomingHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(incomingHash, 'utf8');
  if (a.length !== b.length) {
    return page(
      'Invalid link',
      '<p>This confirmation link is expired or invalid.</p>',
      400,
    );
  }
  let match = false;
  try {
    match = crypto.timingSafeEqual(a, b);
  } catch {
    match = false;
  }
  if (!match) {
    return page(
      'Invalid link',
      '<p>This confirmation link is expired or invalid.</p>',
      400,
    );
  }

  await pool.query(
    `UPDATE subscribers
     SET confirmed_at = NOW(), confirm_token = NULL
     WHERE id = $1`,
    [id],
  );
  return page(
    'Subscribed',
    `<p>Thanks for confirming. New work is rare — see you soon.</p>
     <p><a href="/">Back to Wildlight</a></p>`,
  );
}
