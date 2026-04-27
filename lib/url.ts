/**
 * Returns the input URL only if it parses and uses http: or https:.
 * Returns null for any other protocol (javascript:, data:, vbscript:, file:,
 * etc.) or unparseable input.
 *
 * Use at every write boundary where untrusted-source URLs (Printful payloads,
 * admin uploads, customer input) land in a column or string that downstream
 * renderers will drop into HTML attributes (`<a href>`, `<img src>`).
 * `escapeHtml` neutralizes attribute-breakout (`<>"'&`) but does NOT restrict
 * the protocol — without this guard, a malicious or compromised upstream
 * could inject `javascript:` into a tracking link or image src.
 */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
