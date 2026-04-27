'use client';

import Link from 'next/link';
import { useCart } from './CartProvider';

export function CartCountBadge({
  className = 'cart-link',
}: {
  className?: string;
}) {
  const cart = useCart();
  const count = cart.lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <Link href="/shop/cart" className={className}>
      Cart
      {count > 0 && <span className="cart-dot">{count}</span>}
    </Link>
  );
}
