/**
 * Thin logger wrapper. Forwards to Sentry if @sentry/nextjs is configured
 * with a DSN; otherwise just logs to stdout/stderr.
 */
type Meta = Record<string, unknown>;

async function maybeSentry() {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return null;
  try {
    const Sentry = await import('@sentry/nextjs');
    return Sentry;
  } catch {
    return null;
  }
}

export const logger = {
  info: (msg: string, meta?: Meta) => {
    // eslint-disable-next-line no-console
    console.log(`[info] ${msg}`, meta ?? '');
  },
  warn: (msg: string, meta?: Meta) => {
    // eslint-disable-next-line no-console
    console.warn(`[warn] ${msg}`, meta ?? '');
    maybeSentry().then((s) => s?.captureMessage(msg, { level: 'warning', extra: meta }));
  },
  error: (msg: string, err: unknown, meta?: Meta) => {
    // eslint-disable-next-line no-console
    console.error(`[error] ${msg}`, err, meta ?? '');
    maybeSentry().then((s) => {
      if (!s) return;
      if (err instanceof Error) s.captureException(err, { extra: { msg, ...meta } });
      else s.captureMessage(msg, { level: 'error', extra: { err, ...meta } });
    });
  },
};
