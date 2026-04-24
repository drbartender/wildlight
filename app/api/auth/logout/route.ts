export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { clearAdminSession } from '@/lib/session';

export async function POST() {
  await clearAdminSession();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'), { status: 303 });
}
