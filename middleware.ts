import { NextResponse, type NextRequest } from 'next/server';

// When ADMIN_HOST is set (production), serve the admin section from a
// dedicated subdomain — e.g. `admin.wildlightimagery.com`. The shop stays on
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
    // /admin/* and the root admin routes serve directly. We previously
    // redirected /admin/foo → /foo to keep the URL bar tidy, but Next.js 16
    // strips RSC headers in middleware so we can't differentiate soft-nav
    // RSC fetches from hard navigations — and redirects on RSC fetches
    // render not-found.tsx instead of being followed. Letting /admin/* serve
    // as-is keeps every internal Link / router.push working. The URL bar
    // ends up showing /admin/... for internal navigation; bare /... paths
    // still rewrite below for direct visitors.
    if (
      path === '/admin' ||
      path.startsWith('/admin/') ||
      path === '/login' ||
      path.startsWith('/api/') ||
      isStaticOrInternal
    ) {
      return NextResponse.next();
    }

    // Everything else on the admin host gets transparently rewritten under
    // /admin/<path>, so `admin.wildlightimagery.com/orders` serves the
    // existing `/admin/orders` route.
    const rewritten = url.clone();
    rewritten.pathname = `/admin${path === '/' ? '' : path}`;
    return NextResponse.rewrite(rewritten);
  }

  // Off-host (apex, www): keep the entire admin surface bound to the admin
  // subdomain so the session cookie can never be minted on or replayed
  // against apex. Redirect:
  //   - /admin/*           → admin host, with the /admin prefix stripped
  //   - /login             → admin host /login (so the form posts there)
  //   - /api/auth/login    → admin host (so setAdminSession scopes the
  //                          cookie to admin.<host>, not apex)
  //   - /api/admin/*       → admin host (defense-in-depth — if a cookie
  //                          ever ends up scoped to apex, the redirect
  //                          stops the apex-scoped cookie from being
  //                          replayed against admin endpoints)
  if (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/login' ||
    path === '/api/auth/login' ||
    path.startsWith('/api/admin/')
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
