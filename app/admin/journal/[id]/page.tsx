import { redirect } from 'next/navigation';
import { parsePathId } from '@/lib/db';

// Legacy chapter-edit route — Studio composer takes over editing too.
// We pass the id straight through so the composer loads it on mount.
// A bad id (non-numeric) just lands on a blank journal composer.
export const dynamic = 'force-dynamic';

export default async function EditChapterRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = parsePathId(raw);
  redirect(
    id == null
      ? '/admin/studio?kind=journal'
      : `/admin/studio?kind=journal&id=${id}`,
  );
}
