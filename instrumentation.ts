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
  error,
  request,
  errorContext,
) => {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  // Webhook URLs carry the auth token in `?token=` (Printful) — scrub before
  // forwarding so the secret doesn't end up in Sentry events.
  const safe = request?.path
    ? { ...request, path: request.path.replace(/([?&])token=[^&]*/gi, '$1token=[redacted]') }
    : request;
  return Sentry.captureRequestError(error, safe, errorContext);
};
