import { JournalEditor } from '@/components/admin/JournalEditor';
import { requireAdminOrRedirect } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewJournalEntry() {
  await requireAdminOrRedirect();
  return <JournalEditor isEdit={false} />;
}
