import type { ReactNode } from 'react';

// Nav + Footer + CartProvider get wired in during Phase 4; placeholder layout for Phase 0 builds.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
