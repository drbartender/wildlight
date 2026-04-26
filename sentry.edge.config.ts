import * as Sentry from '@sentry/nextjs';

const TOKEN_QS = /([?&])token=[^&]*/gi;

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  beforeSend(event) {
    if (event.request?.url) {
      event.request.url = event.request.url.replace(TOKEN_QS, '$1token=[redacted]');
    }
    const qs = event.request?.query_string;
    if (typeof qs === 'string') {
      event.request!.query_string = qs.replace(/(^|&)token=[^&]*/gi, '$1token=[redacted]');
    }
    return event;
  },
});
