export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';
import { isValidShopIndexLimit } from '@/lib/shop-limit';

// The key is an ENUM, not a free-form string, so a generic key/value table can
// never be written by a generic writer.
const Body = z.object({
  key: z.enum(['shop_index_limit']),
  value: z.number().int().refine(isValidShopIndexLimit, 'out of range'),
});

export async function PATCH(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { key, value } = parsed.data;

  try {
    // Upsert, not a plain UPDATE, which is a silent no-op when the seed row is
    // missing (a database restored from before this feature shipped).
    await pool.query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)],
    );
  } catch (err) {
    logger.error('site settings write failed', err, { key });
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
