'use client';

import { useEffect } from 'react';
import { useCart } from './CartProvider';

// Renders nothing — exists so the order receipt page can drop the
// localStorage cart once after the buyer completes checkout. Mounting it
// only on the success view keeps the cart intact through retries and
// declines on /checkout.
export function ClearCartOnMount() {
  const cart = useCart();
  useEffect(() => {
    if (!cart.ready) return;
    if (cart.lines.length === 0) return;
    cart.clear();
  }, [cart]);
  return null;
}
