import { requireAdminOrRedirect } from '@/lib/session';
import { parsePathId } from '@/lib/db';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import StudioComposer from '@/components/admin/StudioComposer';
import type { StudioKind } from '@/lib/studio-drafts';

export const dynamic = 'force-dynamic';

interface SearchParams {
  kind?: string;
  id?: string;
  new?: string;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdminOrRedirect();

  const sp = await searchParams;
  const kind: StudioKind =
    sp.kind === 'newsletter' ? 'newsletter' : 'journal';
  const id = parsePathId(sp.id);
  const forceNew = sp.new === '1';

  const title = kind === 'journal' ? 'Journal entry' : 'Newsletter';

  return (
    <>
      <AdminTopBar title={title} subtitle="Studio · Composer" />
      {/*
        `key` forces a fresh mount whenever kind or draft id changes.
        Without it, App Router keeps the same StudioComposer instance
        across `?kind=` / `?id=` searchParam changes (the route
        segment doesn't change), and `useState(initialKind)` ignores
        its updated arg — so all the internal state (kind, draftId,
        doc, refs, save queue) silently goes stale on tab switch.
      */}
      <StudioComposer
        key={`${kind}:${id ?? 'new'}`}
        initialKind={kind}
        initialId={id}
        forceNew={forceNew}
      />
    </>
  );
}
