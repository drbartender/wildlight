import { redirect } from 'next/navigation';

// Legacy chapter-list route — Studio's right-rail "Recent entries"
// replaces the standalone listing. Old bookmarks land on the composer
// with the journal kind preselected.
export const dynamic = 'force-dynamic';

export default function JournalListRedirect() {
  redirect('/admin/studio?kind=journal');
}
