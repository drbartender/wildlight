import type { ReactNode } from 'react';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { CartProvider } from '@/components/shop/CartProvider';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <div className="wl-surface">
        <Nav />
        <main>{children}</main>
        <Footer />
      </div>
    </CartProvider>
  );
}
