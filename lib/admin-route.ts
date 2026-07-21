/**
 * Wrapper that lets the admin guards actually answer with their own status.
 *
 * `requireAdmin` (lib/session.ts) and `requireSameOrigin` (lib/origin-check.ts)
 * both signal denial by THROWING a Response. Next.js does not surface that from
 * a route handler: `app-route/module.js` catches only redirect and
 * HTTP-access-fallback errors and rethrows everything else, so the thrown
 * Response became a bare **500 with an empty body** instead of the 401/403 it
 * was built to be.
 *
 * That failed closed, so no unauthorised write ever happened, but it cost a
 * Sentry exception on every expired session and left clients nothing to branch
 * on: an expired cookie mid-drag was indistinguishable from a server fault.
 * Verified against the live deployment before this was written, on both the
 * unauthenticated and the cross-origin path.
 *
 * It cannot be fixed centrally in middleware: lib/auth.ts uses `jsonwebtoken`
 * and lib/session.ts imports `pool`, neither of which runs on the Edge runtime.
 * So it is fixed at the route layer, where the throw is caught and returned.
 *
 * Only Responses are converted. Any other error still propagates, so genuine
 * faults keep their 500 and keep reaching Sentry.
 */
type RouteHandler<C> = (req: Request, ctx: C) => Promise<Response>;

export function adminRoute<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
  };
}
