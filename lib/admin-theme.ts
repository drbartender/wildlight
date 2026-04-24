import { cookies } from 'next/headers';

export type AdminTheme = 'light' | 'dark';

export const ADMIN_THEME_COOKIE = 'wl_admin_theme';

export async function readAdminTheme(): Promise<AdminTheme> {
  const v = (await cookies()).get(ADMIN_THEME_COOKIE)?.value;
  return v === 'dark' ? 'dark' : 'light';
}
