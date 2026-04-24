export const runtime = 'nodejs';
import { pool } from '@/lib/db';
import { verifyUnsubToken } from '@/lib/unsubscribe-token';

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

async function unsubscribe(id: number, email: string, token: string): Promise<Response> {
  if (!Number.isFinite(id) || id <= 0 || !email || !token) {
    return page('Invalid link', '<p>This unsubscribe link is malformed.</p>', 400);
  }
  if (!verifyUnsubToken(id, email, token)) {
    return page('Invalid link', '<p>This unsubscribe link is expired or invalid.</p>', 400);
  }
  const r = await pool.query<{ email: string }>(
    `UPDATE subscribers
     SET unsubscribed_at = COALESCE(unsubscribed_at, NOW())
     WHERE id = $1 AND email = $2
     RETURNING email`,
    [id, email.toLowerCase()],
  );
  if (!r.rowCount) {
    return page(
      'Not found',
      `<p>We couldn't find a subscription for ${email}. It may have already been removed.</p>`,
    );
  }
  return page(
    'Unsubscribed',
    `<p>${r.rows[0].email} has been removed from our list.</p>
     <p>We're sorry to see you go.</p>`,
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id') || '0');
  const email = (url.searchParams.get('e') || '').trim();
  const token = url.searchParams.get('t') || '';
  return unsubscribe(id, email, token);
}

// RFC 8058 one-click unsubscribe: MUAs POST here with header
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
export async function POST(req: Request) {
  const url = new URL(req.url);
  // Params may be in query string (header-mode) or form body.
  const qs = {
    id: Number(url.searchParams.get('id') || '0'),
    email: (url.searchParams.get('e') || '').trim(),
    token: url.searchParams.get('t') || '',
  };
  if (!qs.id || !qs.email || !qs.token) {
    const body = await req.formData().catch(() => null);
    if (body) {
      qs.id = Number(body.get('id') || '0');
      qs.email = String(body.get('e') || '').trim();
      qs.token = String(body.get('t') || '');
    }
  }
  return unsubscribe(qs.id, qs.email, qs.token);
}
