export interface LineItem {
  price_cents: number;
  quantity: number;
}

export function subtotalCents(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.price_cents * i.quantity, 0);
}

/** Spec threshold: free shipping when pre-tax, pre-shipping subtotal >= $150. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 15000;

export function qualifiesForFreeShipping(subtotal_cents: number): boolean {
  return subtotal_cents >= FREE_SHIPPING_THRESHOLD_CENTS;
}
