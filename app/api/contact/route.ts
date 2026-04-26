export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendContactMessage } from '@/lib/email';
import { recordAndCheckRateLimit, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(5000),
  topic: z.string().max(80).optional(),
  // Honeypot — hidden from humans via CSS, filled by naive form-spamming
  // bots. Server returns 200 OK without sending so the bot doesn't learn
  // it was filtered.
  website: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;
  const ip = getClientIp(req);

  // Rate limit first — every request consumes the bucket so a bot that
  // auto-fills the honeypot still hits the cap (instead of getting silent
  // 200s indefinitely).
  // 5 messages per 15min per IP — generous for a real retry, restrictive
  // enough to prevent inbox spam from a single source.
  const gate = await recordAndCheckRateLimit('contact', ip, 900, 5);
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter ?? 900) } },
    );
  }

  // Silent honeypot drop. 200 OK keeps the bot's success heuristics happy.
  if (d.website) {
    logger.info('contact.honeypot_drop', {
      ip,
      ua: req.headers.get('user-agent') || null,
    });
    return NextResponse.json({ ok: true });
  }

  try {
    await sendContactMessage(
      d.name,
      d.email,
      d.subject || 'contact',
      d.message,
      d.topic,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('contact relay failed', err);
    return NextResponse.json({ error: 'could not send message' }, { status: 500 });
  }
}
