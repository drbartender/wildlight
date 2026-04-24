export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendContactMessage } from '@/lib/email';
import { logger } from '@/lib/logger';

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(5000),
  topic: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;
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
