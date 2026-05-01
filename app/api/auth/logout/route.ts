export const runtime = 'nodejs';
import { NextResponse, type NextRequest } from 'next/server';
import { clearAdminSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  await clearAdminSession();
  // Same-host redirect — the admin cookie is host-scoped, so logout must
  // land back on whatever host issued the request (e.g. the admin subdomain).
  // Hardcoding NEXT_PUBLIC_APP_URL would bounce admin users to the apex.
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
