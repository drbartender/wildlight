import type { ReactNode } from 'react';
import { Nav } from '@/components/shop/Nav';
import { Footer } from '@/components/shop/Footer';
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
