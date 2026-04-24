/*
 * Next.js instrumentation entry point. Runs once per server process at boot.
 * No-op unless SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError: typeof import('@sentry/nextjs').captureRequestError = async (
  ...args
) => {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  return Sentry.captureRequestError(...args);
};
