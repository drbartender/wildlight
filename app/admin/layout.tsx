import './admin.css';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { readAdminTheme } from '@/lib/admin-theme';
import { pool } from '@/lib/db';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminCmdK } from '@/components/admin/AdminCmdK';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/login');

  const theme = await readAdminTheme();

  // Needs-review badge on the sidebar — small query, no join needed.
  let needsReview = 0;
  try {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM orders WHERE status = 'needs_review'`,
    );
    needsReview = rows[0]?.n ?? 0;
  } catch {
    // DB unreachable — render the shell anyway so the admin is usable for
    // non-DB tasks (sign out, theme switch).
    needsReview = 0;
  }

  return (
    <div className="wl-admin-surface" data-theme={theme}>
      <AdminSidebar needsReview={needsReview} email={session.email} />
      <div className="wl-adm-main">
        {children}
        <AdminCmdK />
      </div>
    </div>
  );
}
