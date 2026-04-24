const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUSD(cents: number): string {
  return USD.format(cents / 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Round a cent value UP to the next multiple of 500 cents ($5). Used to snap
 * computed retail prices to clean tags like $30.00, $35.00, $165.00.
 */
export function roundPriceCents(cents: number): number {
  return Math.ceil(cents / 500) * 500;
}
