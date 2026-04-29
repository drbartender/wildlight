import { redirect } from 'next/navigation';

// Legacy "New chapter" route — Studio's composer is the entry point now.
// `new=1` tells the composer to POST a fresh draft on mount.
export const dynamic = 'force-dynamic';

export default function NewChapterRedirect() {
  redirect('/admin/studio?kind=journal&new=1');
}
