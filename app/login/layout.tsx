import type { ReactNode } from 'react';
import '../admin/admin.css';
import { readAdminTheme } from '@/lib/admin-theme';

// Login reuses the admin design system, so we import its CSS and wrap the
// page in the same `.wl-admin-surface` container. Importing admin.css from
// two places is fine under Next's CSS deduplication.

export default async function LoginLayout({ children }: { children: ReactNode }) {
  const theme = await readAdminTheme();
  return (
    <div className="wl-admin-surface" data-theme={theme} style={{ display: 'block' }}>
      {children}
    </div>
  );
}
