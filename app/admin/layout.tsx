import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { AdminNav } from '@/components/admin/AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/login');

  return (
    <div style={{ fontFamily: 'Georgia, serif', background: '#fff', minHeight: '100vh' }}>
      <AdminNav currentEmail={session.email} />
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
