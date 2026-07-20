import '../admin/admin.css';
import type { ReactNode } from 'react';

// Dev-only visual harness for admin surfaces. Mirrors app/login/layout.tsx,
// which also imports admin.css from outside /admin so a page can render inside
// the same `.wl-admin-surface` shell without the admin layout's auth + DB.
export default function DevPreviewLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
