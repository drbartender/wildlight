import { notFound } from 'next/navigation';
import {
  JournalEditor,
  type JournalEntry,
} from '@/components/admin/JournalEditor';
import { requireAdminOrRedirect } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EditJournalEntry({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminOrRedirect();
  const { id: raw } = await params;
  const id = parsePathId(raw);
  if (id == null) notFound();

  const r = await pool.query<JournalEntry>(
    `SELECT id, slug, title, excerpt, body, cover_image_url,
            published, published_at::text
     FROM blog_posts WHERE id = $1`,
    [id],
  );
  const entry = r.rows[0];
  if (!entry) notFound();

  return <JournalEditor initial={entry} isEdit={true} />;
}
