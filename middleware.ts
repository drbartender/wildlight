import { NextResponse, type NextRequest } from 'next/server';

// When ADMIN_HOST is set (production), serve the admin section from a
// dedicated subdomain — e.g. `admin.wildlightimagery.shop`. The shop stays on
// the apex/www host. Local dev and Vercel previews leave ADMIN_HOST unset and
// keep the admin reachable at the path-based `/admin/*` URL.
const ADMIN_HOST = process.env.ADMIN_HOST?.toLowerCase();

export function middleware(req: NextRequest) {
  if (!ADMIN_HOST) return NextResponse.next();

  const url = req.nextUrl;
  const path = url.pathname;
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();

  // Static assets and platform internals pass through on every host so they
  // aren't rewritten under /admin/* and broken (e.g. /favicon.ico,
  // /og.png, /_next/data/..., /_vercel/insights/...).
  const isStaticOrInternal =
    path.startsWith('/_next/') ||
    path.startsWith('/_vercel/') ||
    /\.[a-z0-9]+$/i.test(path);

  if (host === ADMIN_HOST) {
    // 308 normalize legacy /admin/* URLs to clean paths. Existing internal
    // links and redirects (`<Link href="/admin/orders">`, `redirect('/admin')`)
    // get bounced once and then rewritten back below — so the URL bar shows
    // `/orders` instead of `/admin/orders`.
    if (path === '/admin' || path.startsWith('/admin/')) {
      const dest = url.clone();
      dest.pathname = path.replace(/^\/admin/, '') || '/';
      return NextResponse.redirect(dest, 308);
    }

    // Routes with their own files outside /admin/* — serve as-is.
    if (path === '/login' || path.startsWith('/api/') || isStaticOrInternal) {
      return NextResponse.next();
    }

    // Everything else on the admin host gets transparently rewritten under
    // /admin/<path>, so `admin.wildlightimagery.shop/orders` serves the
    // existing `/admin/orders` route.
    const rewritten = url.clone();
    rewritten.pathname = `/admin${path === '/' ? '' : path}`;
    return NextResponse.rewrite(rewritten);
  }

  // Off-host (apex, www): keep the admin login surface bound to the admin
  // subdomain so the session cookie can never be minted on apex. Redirect:
  //   - /admin/*           → admin host, with the /admin prefix stripped
  //   - /login             → admin host /login (so the form posts there)
  //   - /api/auth/login    → admin host (so setAdminSession scopes the
  //                          cookie to admin.<host>, not apex)
  if (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/login' ||
    path === '/api/auth/login'
  ) {
    const dest = url.clone();
    dest.host = ADMIN_HOST;
    dest.protocol = 'https:';
    dest.port = '';
    if (path === '/admin' || path.startsWith('/admin/')) {
      dest.pathname = path.replace(/^\/admin/, '') || '/';
    }
    return NextResponse.redirect(dest, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
