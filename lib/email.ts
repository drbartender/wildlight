import { Resend } from 'resend';
import { safeHttpUrl } from './url';

const FROM = process.env.RESEND_FROM_EMAIL || 'orders@wildlightimagery.shop';
const BROADCAST_FROM = process.env.RESEND_BROADCAST_FROM || 'news@wildlightimagery.shop';

let _resend: Resend | null = null;
function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY missing');
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export interface OrderConfirmationData {
  to: string;
  orderToken: string;
  customerName?: string | null;
  items: Array<{
    title: string;
    variant: string;
    /** Line total (unit price × quantity), already formatted as USD. */
    lineTotal: string;
    qty: number;
    imageUrl?: string;
  }>;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  /** Stripe-collected shipping address. Optional so test orders without a
   *  full address still send the email; the address block just renders empty. */
  shippingAddress?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  siteUrl: string;
}

// Trim transactional palette. Light values are inlined on every element.
// The <style> block in <head> overrides them for recipients in dark mode
// via @media (prefers-color-scheme: dark). Mail clients that don't honor
// the @media query (some Gmail configs, Outlook desktop) just see the
// light defaults — readable in either client mode, just not adapted.
const C = {
  bg: '#f2ede1',
  fg: '#16130c',
  fg2: '#3b362a',
  fg3: '#6a6452',
  rule: 'rgba(22, 19, 12, 0.14)',
  thumbFallback: '#ebe4d3',
};

// System font stack — no remote font files. Mail clients use whichever is
// installed; Georgia is the consistent serif fallback we can rely on.
const FONT_SERIF = "Georgia, 'Times New Roman', Times, serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

// Inline aperture mark — same five-petal sweep as components/brand/ApertureMark.tsx,
// rendered as static SVG so the email doesn't depend on a hosted asset. Apple
// Mail / iOS Mail / Gmail / Outlook web render this crisply. Outlook desktop
// strips inline SVG; in that case the wordmark text alongside still shows
// brand identity, which is the fallback we want.
const APERTURE_SVG = `<svg width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;">
  <path d="M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z" fill="#d94335"/>
  <path d="M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z" fill="#e6892a" transform="rotate(72 50 50)"/>
  <path d="M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z" fill="#e4bb22" transform="rotate(144 50 50)"/>
  <path d="M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z" fill="#6eaa35" transform="rotate(216 50 50)"/>
  <path d="M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z" fill="#2a73b3" transform="rotate(288 50 50)"/>
</svg>`;

function darkModeStyleBlock(): string {
  // <style> in <head> with class-based @media overrides. The classes are
  // also used as anchors for inline styles so a client that strips <style>
  // still gets readable (light) output.
  return `
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      @media (prefers-color-scheme: dark) {
        body, .wl-bg { background-color: #141210 !important; }
        .wl-fg { color: #f2ede1 !important; }
        .wl-fg2 { color: #d8d2c1 !important; }
        .wl-fg3 { color: #a9a390 !important; }
        .wl-rule { border-color: rgba(242, 237, 225, 0.14) !important; }
        .wl-thumb-fallback { background-color: #1b1814 !important; }
        .wl-link { color: #f2ede1 !important; }
      }
    </style>`;
}

function brandHeader(): string {
  // Mark + wordmark on one row. If Outlook strips the SVG, the wordmark
  // text still anchors the email's identity.
  return `
    <tr><td class="wl-rule" style="padding:6px 0 18px;border-bottom:1px solid ${C.rule};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle" style="padding-right:10px;line-height:0;">${APERTURE_SVG}</td>
          <td valign="middle" class="wl-fg2" style="font-family:${FONT_MONO};font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${C.fg2};">Wildlight Imagery</td>
        </tr>
      </table>
    </td></tr>`;
}

function labelInline(): string {
  return `font-family:${FONT_MONO};font-size:10px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${C.fg3};`;
}

function itemRow(opts: {
  title: string;
  variant: string;
  qty: number;
  imageUrl?: string | null;
  trailing?: string;
}): string {
  // Defense-in-depth: only http(s) URLs render as images. Any other
  // protocol (javascript:, data:, etc.) falls back to the placeholder.
  const safeImage = safeHttpUrl(opts.imageUrl);
  const thumb = safeImage
    ? `<img src="${escapeHtml(safeImage)}" alt="" width="64" height="64" style="display:block;border:1px solid ${C.rule};object-fit:cover;" />`
    : `<div class="wl-thumb-fallback wl-rule" style="width:64px;height:64px;background:${C.thumbFallback};border:1px solid ${C.rule};"></div>`;
  const trailingCell =
    opts.trailing != null
      ? `<td valign="top" align="right" class="wl-rule wl-fg" style="padding:14px 0 14px 12px;border-bottom:1px solid ${C.rule};font-family:${FONT_SERIF};font-size:15px;color:${C.fg};white-space:nowrap;">${opts.trailing}</td>`
      : '';
  return `
    <tr>
      <td width="64" valign="top" style="padding:14px 14px 14px 0;">${thumb}</td>
      <td valign="top" class="wl-rule" style="padding:14px 0;border-bottom:1px solid ${C.rule};font-family:${FONT_SERIF};">
        <div class="wl-fg" style="font-size:15px;color:${C.fg};margin-bottom:4px;line-height:1.35;">${escapeHtml(opts.title)}</div>
        <div class="wl-fg3" style="${labelInline()}">${escapeHtml(opts.variant)} · ×${opts.qty}</div>
      </td>
      ${trailingCell}
    </tr>`;
}

function trackingBlock(opts: {
  carrier?: string | null;
  service?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}): string {
  const label =
    opts.carrier && opts.service
      ? `${escapeHtml(opts.carrier)} · ${escapeHtml(opts.service)}`
      : opts.carrier
        ? escapeHtml(opts.carrier)
        : 'Tracking';
  const numberDisplay = opts.trackingNumber
    ? `<div class="wl-fg" style="font-family:${FONT_MONO};font-size:14px;font-weight:500;color:${C.fg};margin-top:4px;word-break:break-all;">${escapeHtml(opts.trackingNumber)}</div>`
    : `<div class="wl-fg2" style="font-family:${FONT_SERIF};font-size:14px;color:${C.fg2};margin-top:4px;font-style:italic;">Tracking details to follow shortly.</div>`;
  // Defense-in-depth: drop the link entirely if the URL isn't http(s).
  // Webhook write boundary already filters; this is a backstop for
  // historical rows persisted before that gate.
  const safeTrackingUrl = safeHttpUrl(opts.trackingUrl);
  const trackLink = safeTrackingUrl
    ? `<div style="margin-top:10px;"><a class="wl-link wl-fg" href="${escapeHtml(safeTrackingUrl)}" style="color:${C.fg};text-decoration:underline;font-family:${FONT_SERIF};font-size:14px;">Track this package →</a></div>`
    : '';
  return `
    <tr><td style="padding:24px 0 8px;">
      <span class="wl-fg3" style="${labelInline()}display:block;margin-bottom:4px;">${label}</span>
      ${numberDisplay}
      ${trackLink}
    </td></tr>`;
}

function shippingBlock(addr: OrderConfirmationData['shippingAddress'], name?: string | null): string {
  if (!addr || !addr.line1) return '';
  const lines = [
    name,
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(' ') || null,
    addr.country,
  ]
    .filter(Boolean)
    // String() is defensive against schema drift in shipping_address JSONB —
    // if a non-string truthy value slips past filter(Boolean), this turns
    // it into a string instead of throwing inside .replace.
    .map((l) => escapeHtml(String(l)))
    .join('<br/>');
  return `
    <tr><td style="padding:24px 0 4px;"><span class="wl-fg3" style="${labelInline()}">Ships to</span></td></tr>
    <tr><td class="wl-fg2" style="padding:0 0 24px;font-family:${FONT_SERIF};font-size:14px;line-height:1.55;color:${C.fg2};">${lines}</td></tr>`;
}

function plainAddress(addr: OrderConfirmationData['shippingAddress'], name?: string | null): string {
  if (!addr || !addr.line1) return '';
  return [
    name,
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(' ') || null,
    addr.country,
  ]
    .filter(Boolean)
    .map(String)
    .join('\n');
}

function plainOrderConfirmation(data: OrderConfirmationData): string {
  const orderRef = data.orderToken.slice(0, 8);
  const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
  const lines: string[] = [];
  lines.push('WILDLIGHT IMAGERY');
  lines.push('');
  lines.push(`Order ${orderRef} — received`);
  lines.push('');
  lines.push(
    "Your order is in. Archival prints, made to order in Aurora, Colorado. Most ship in 5-7 business days. We'll send a second email with tracking the moment it's on the way.",
  );
  lines.push('');
  lines.push('PLATES');
  for (const i of data.items) {
    lines.push(`  ${i.title}`);
    lines.push(`    ${i.variant} · ×${i.qty}    ${i.lineTotal}`);
  }
  lines.push('');
  lines.push(`Subtotal:  ${data.subtotal}`);
  lines.push(`Shipping:  ${data.shipping}`);
  lines.push(`Tax:       ${data.tax}`);
  lines.push(`TOTAL:     ${data.total}`);
  const ship = plainAddress(data.shippingAddress, data.customerName);
  if (ship) {
    lines.push('');
    lines.push('SHIPS TO');
    lines.push(ship);
  }
  lines.push('');
  lines.push(`View your order: ${orderUrl}`);
  lines.push('');
  lines.push('—');
  lines.push('Wildlight Imagery — work by Dan Raby, Aurora, Colorado.');
  lines.push('Questions? Reply to this email.');
  return lines.join('\n');
}

function plainOrderShipped(data: OrderShippedData): string {
  const orderRef = data.orderToken.slice(0, 8);
  const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
  const isFirst = data.shipmentNumber <= 1;
  const headline = isFirst
    ? data.moreOnTheWay
      ? 'Part of your order is on the way.'
      : 'Your order is on the way.'
    : `Shipment ${data.shipmentNumber} is on the way.`;
  const headerLabel = isFirst ? 'shipped' : `shipped · part ${data.shipmentNumber}`;
  const lines: string[] = [];
  lines.push('WILDLIGHT IMAGERY');
  lines.push('');
  lines.push(`Order ${orderRef} — ${headerLabel}`);
  lines.push('');
  lines.push(headline);
  lines.push('');
  lines.push(
    'Your prints are out the door from Aurora, Colorado. Most US shipments arrive in 3-5 business days from the carrier scan.',
  );
  lines.push('');
  const carrierLabel =
    data.carrier && data.service
      ? `${data.carrier} · ${data.service}`
      : data.carrier || 'Tracking';
  lines.push(carrierLabel);
  if (data.trackingNumber) lines.push(data.trackingNumber);
  else lines.push('(Tracking details to follow shortly.)');
  const safeTracking = safeHttpUrl(data.trackingUrl);
  if (safeTracking) {
    lines.push(`Track this package: ${safeTracking}`);
  }
  if (data.moreOnTheWay) {
    lines.push('');
    lines.push(
      "MORE ON THE WAY: The rest of your order is still in fulfillment. We'll send another email when that package ships.",
    );
  }
  lines.push('');
  lines.push('IN YOUR ORDER');
  for (const i of data.items) {
    lines.push(`  ${i.title}`);
    lines.push(`    ${i.variant} · ×${i.qty}`);
  }
  const ship = plainAddress(data.shippingAddress, data.customerName);
  if (ship) {
    lines.push('');
    lines.push('SHIPS TO');
    lines.push(ship);
  }
  lines.push('');
  lines.push(`View your order: ${orderUrl}`);
  lines.push('');
  lines.push('—');
  lines.push('Wildlight Imagery — work by Dan Raby, Aurora, Colorado.');
  lines.push('Questions? Reply to this email.');
  return lines.join('\n');
}

// Build aligned totals as a plain table (no colored panel). Light-mode
// inline styles are present; dark-mode adjusts via the .wl- classes.
function totalsBlock(data: OrderConfirmationData): string {
  const row = (label: string, value: string, isTotal = false): string => {
    const labelStyle = isTotal
      ? `padding:14px 0 0;border-top:1px solid ${C.rule};font-family:${FONT_SERIF};font-size:15px;font-weight:600;color:${C.fg};`
      : `padding:6px 0;font-family:${FONT_SERIF};font-size:14px;color:${C.fg2};`;
    const valueStyle = isTotal
      ? `padding:14px 0 0;border-top:1px solid ${C.rule};font-family:${FONT_SERIF};font-size:15px;font-weight:600;color:${C.fg};`
      : `padding:6px 0;font-family:${FONT_SERIF};font-size:14px;color:${C.fg2};`;
    const cls = isTotal ? 'wl-rule wl-fg' : 'wl-fg2';
    return `
      <tr>
        <td class="${cls}" style="${labelStyle}">${escapeHtml(label)}</td>
        <td class="${cls}" align="right" style="${valueStyle}">${value}</td>
      </tr>`;
  };
  return `
    <tr><td style="padding:8px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${row('Subtotal', data.subtotal)}
        ${row('Shipping', data.shipping)}
        ${row('Tax', data.tax)}
        ${row('Total', data.total, true)}
      </table>
    </td></tr>`;
}

export async function sendOrderConfirmation(data: OrderConfirmationData) {
  const orderRef = data.orderToken.slice(0, 8);
  const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
  const itemsHtml = data.items
    .map((i) => itemRow({ ...i, trailing: i.lineTotal }))
    .join('');
  const ship = shippingBlock(data.shippingAddress, data.customerName);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>Your Wildlight order</title>
  ${darkModeStyleBlock()}
</head>
<body class="wl-bg" style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wl-bg" style="background:${C.bg};padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        ${brandHeader()}

        <tr><td style="padding:24px 0 6px;">
          <span class="wl-fg3" style="${labelInline()}">Order ${escapeHtml(orderRef)} · received</span>
        </td></tr>
        <tr><td class="wl-fg" style="padding:0 0 18px;font-family:${FONT_SERIF};font-size:18px;font-weight:600;color:${C.fg};letter-spacing:-0.005em;">
          Thank you. Your order is in.
        </td></tr>

        <tr><td class="wl-fg2" style="padding-bottom:18px;font-family:${FONT_SERIF};font-size:14px;line-height:1.6;color:${C.fg2};">
          Archival prints, made to order in Aurora, Colorado. Most ship in 5–7 business days. We'll send a second email with tracking the moment it's on the way.
        </td></tr>

        <tr><td style="padding:8px 0 4px;"><span class="wl-fg3" style="${labelInline()}">Plates</span></td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemsHtml}</table>
        </td></tr>

        ${totalsBlock(data)}

        ${ship}

        <tr><td style="padding:0 0 24px;">
          <a class="wl-link wl-fg" href="${escapeHtml(orderUrl)}" style="color:${C.fg};text-decoration:underline;font-family:${FONT_SERIF};font-size:14px;font-weight:500;">View your order →</a>
        </td></tr>

        <tr><td class="wl-rule wl-fg3" style="padding:18px 0 0;border-top:1px solid ${C.rule};font-family:${FONT_SERIF};font-size:12px;color:${C.fg3};line-height:1.6;">
          Wildlight Imagery — work by Dan Raby, Aurora, Colorado.<br/>
          Questions? Just reply to this email.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return resend().emails.send({
    from: FROM,
    to: data.to,
    subject: `Your Wildlight order ${orderRef}`,
    html,
    text: plainOrderConfirmation(data),
  });
}

export interface OrderShippedData {
  to: string;
  orderToken: string;
  customerName?: string | null;
  /** All items in the order (not just this shipment) — the recap so the
   *  customer remembers what they ordered. The "more on the way" line below
   *  the items list signals when not everything is in this package. */
  items: Array<{
    title: string;
    variant: string;
    qty: number;
    imageUrl?: string | null;
  }>;
  shippingAddress?: OrderConfirmationData['shippingAddress'];
  carrier?: string | null;
  service?: string | null;
  trackingUrl?: string | null;
  trackingNumber?: string | null;
  /** 1-indexed sequence number — `1` for the first shipment, `2` for the
   *  next, etc. Drives the "shipment N" subject line and headline copy. */
  shipmentNumber: number;
  /** True if Printful's shipment payload listed fewer items than the order
   *  contains, which means another package is still in fulfillment. The
   *  email shows a callout so the recipient isn't surprised. */
  moreOnTheWay?: boolean;
  siteUrl: string;
}

export async function sendOrderShipped(data: OrderShippedData) {
  const orderRef = data.orderToken.slice(0, 8);
  const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
  const itemsHtml = data.items.map((i) => itemRow(i)).join('');
  const ship = shippingBlock(data.shippingAddress, data.customerName);
  const tracking = trackingBlock({
    carrier: data.carrier,
    service: data.service,
    trackingNumber: data.trackingNumber,
    trackingUrl: data.trackingUrl,
  });

  const isFirst = data.shipmentNumber <= 1;
  const headline = isFirst
    ? data.moreOnTheWay
      ? 'Part of your order is on the way.'
      : 'Your order is on the way.'
    : `Shipment ${data.shipmentNumber} is on the way.`;
  const headerLabel = isFirst
    ? 'shipped'
    : `shipped · part ${data.shipmentNumber}`;

  const moreCallout = data.moreOnTheWay
    ? `
      <tr><td class="wl-fg2" style="padding:8px 0 16px;font-family:${FONT_SERIF};font-size:13px;color:${C.fg2};line-height:1.55;font-style:italic;">
        The rest of your order is still in fulfillment — we'll send another email when that package ships.
      </td></tr>`
    : '';

  const subject = isFirst
    ? `Your Wildlight order ${orderRef} has shipped`
    : `Your Wildlight order ${orderRef} — shipment ${data.shipmentNumber}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>${escapeHtml(subject)}</title>
  ${darkModeStyleBlock()}
</head>
<body class="wl-bg" style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wl-bg" style="background:${C.bg};padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        ${brandHeader()}

        <tr><td style="padding:24px 0 6px;">
          <span class="wl-fg3" style="${labelInline()}">Order ${escapeHtml(orderRef)} · ${escapeHtml(headerLabel)}</span>
        </td></tr>
        <tr><td class="wl-fg" style="padding:0 0 18px;font-family:${FONT_SERIF};font-size:18px;font-weight:600;color:${C.fg};letter-spacing:-0.005em;">
          ${escapeHtml(headline)}
        </td></tr>

        <tr><td class="wl-fg2" style="padding-bottom:0;font-family:${FONT_SERIF};font-size:14px;line-height:1.6;color:${C.fg2};">
          Your prints are out the door from Aurora, Colorado. Most US shipments arrive in 3–5 business days from the carrier scan.
        </td></tr>

        ${tracking}

        ${moreCallout}

        <tr><td style="padding:24px 0 4px;"><span class="wl-fg3" style="${labelInline()}">In your order</span></td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemsHtml}</table>
        </td></tr>

        ${ship}

        <tr><td style="padding:0 0 24px;">
          <a class="wl-link wl-fg" href="${escapeHtml(orderUrl)}" style="color:${C.fg};text-decoration:underline;font-family:${FONT_SERIF};font-size:14px;font-weight:500;">View your order →</a>
        </td></tr>

        <tr><td class="wl-rule wl-fg3" style="padding:18px 0 0;border-top:1px solid ${C.rule};font-family:${FONT_SERIF};font-size:12px;color:${C.fg3};line-height:1.6;">
          Wildlight Imagery — work by Dan Raby, Aurora, Colorado.<br/>
          Questions? Just reply to this email.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return resend().emails.send({
    from: FROM,
    to: data.to,
    subject,
    html,
    text: plainOrderShipped(data),
  });
}

export async function sendSubscribeConfirmation(
  to: string,
  subscriberId: number,
  token: string,
  siteUrl: string,
) {
  const base = siteUrl.replace(/\/$/, '');
  const url = `${base}/api/subscribe/confirm?id=${subscriberId}&t=${encodeURIComponent(token)}`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
      <h1 style="font-weight:400;">One quick step.</h1>
      <p>Tap below to confirm your subscription to Wildlight Imagery. New work is rare and we won't share your address.</p>
      <p style="margin:24px 0;">
        <a href="${url}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;text-decoration:none;">
          Confirm subscription
        </a>
      </p>
      <p style="color:#777;font-size:12px;">If you didn't sign up, just ignore this email — no list will be created.</p>
    </div>`;
  return resend().emails.send({
    from: BROADCAST_FROM,
    to,
    subject: 'Confirm your Wildlight Imagery subscription',
    html,
  });
}

export async function sendNeedsReviewAlert(orderId: number, reason: string) {
  const recipients = (process.env.ADMIN_ALERT_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) return;
  return resend().emails.send({
    from: FROM,
    to: recipients,
    subject: `[Wildlight] Order ${orderId} needs review`,
    html:
      `<p>Order ${orderId} could not be auto-fulfilled.</p>` +
      `<p>Reason: ${escapeHtml(reason)}</p>`,
  });
}

export async function sendContactMessage(
  name: string,
  email: string,
  subject: string,
  message: string,
  topic?: string,
) {
  const recipients = (process.env.ADMIN_ALERT_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) throw new Error('no ADMIN_ALERT_EMAIL recipients');
  return resend().emails.send({
    from: FROM,
    to: recipients,
    replyTo: email,
    subject: `[Wildlight] ${topic ? `${topic} — ` : ''}${subject || 'contact'}`,
    html:
      `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>` +
      `<pre style="white-space:pre-wrap;font-family:Georgia,serif">${escapeHtml(message)}</pre>`,
  });
}

export interface BroadcastRecipient {
  id: number;
  email: string;
}

/**
 * Send to confirmed subscribers with per-recipient unsubscribe footers +
 * List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058 one-click).
 * Required for CAN-SPAM / GDPR compliance before any marketing broadcast.
 *
 * `plainEmails` mode exists only for test-sends to arbitrary addresses that
 * aren't in the subscribers table — those skip the footer since there's no
 * real subscriber row to unsubscribe.
 */
export async function sendBroadcast(
  subject: string,
  html: string,
  recipients: BroadcastRecipient[] | string[],
  opts: { siteUrl: string; plainEmails?: boolean } = { siteUrl: '' },
) {
  if (!recipients.length) return [];
  // Lazy-require to keep circular imports at bay if this lib ever ends up
  // imported from unsubscribe-token.
  const { unsubUrl } = await import('./unsubscribe-token');
  const r = resend();
  const results = [];
  const batchSize = 50;

  const messages = recipients.map((rec) => {
    const to = typeof rec === 'string' ? rec : rec.email;
    if (typeof rec === 'string' || opts.plainEmails) {
      // Test-send path: no footer, no headers (no real subscriber row).
      return { from: BROADCAST_FROM, to, subject, html };
    }
    const u = unsubUrl(rec.id, rec.email, opts.siteUrl);
    const footer = `
<hr style="margin:32px 0 16px;border:none;border-top:1px solid #e5e2dc;"/>
<p style="font-family:Georgia,serif;color:#777;font-size:12px;text-align:center;">
  You're receiving this because you subscribed to Wildlight Imagery.
  <a href="${u}" style="color:#777;">Unsubscribe</a>.
</p>`;
    return {
      from: BROADCAST_FROM,
      to,
      subject,
      html: html + footer,
      headers: {
        'List-Unsubscribe': `<${u}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  });

  for (let i = 0; i < messages.length; i += batchSize) {
    const chunk = messages.slice(i, i + batchSize);
    results.push(await r.batch.send(chunk));
  }
  return results;
}
