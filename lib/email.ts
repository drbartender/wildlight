import { Resend } from 'resend';

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

// Email-safe color tokens. Mirror globals.css :root bone palette but inline
// because remote CSS / web fonts don't load reliably in mail clients. We
// intentionally don't try to honor the recipient's bone/ink mood — the email
// is read in their mail client which has its own dark-mode handling.
const E = {
  paper: '#f2ede1',
  paper2: '#ebe4d3',
  ink: '#16130c',
  ink2: '#3b362a',
  ink3: '#6a6452',
  rule: 'rgba(22, 19, 12, 0.14)',
  font: "'EB Garamond', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Menlo, Consolas, monospace",
};

function labelStyle(extra = ''): string {
  return `font-family:${E.mono};font-size:10px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:${E.ink3};${extra}`;
}

function rowItem(i: OrderConfirmationData['items'][number]): string {
  const thumb = i.imageUrl
    ? `<img src="${escapeHtml(i.imageUrl)}" alt="" width="72" height="72" style="display:block;border:1px solid ${E.rule};object-fit:cover;" />`
    : `<div style="width:72px;height:72px;background:${E.paper2};border:1px solid ${E.rule};"></div>`;
  return `
    <tr>
      <td width="72" valign="top" style="padding:16px 16px 16px 0;">${thumb}</td>
      <td valign="top" style="padding:16px 0;border-bottom:1px solid ${E.rule};font-family:${E.font};">
        <div style="font-size:18px;color:${E.ink};margin-bottom:4px;line-height:1.25;">${escapeHtml(i.title)}</div>
        <div style="${labelStyle('color:' + E.ink3 + ';')}">${escapeHtml(i.variant)} · ×${i.qty}</div>
      </td>
      <td valign="top" align="right" style="padding:16px 0 16px 16px;border-bottom:1px solid ${E.rule};font-family:${E.font};font-size:18px;color:${E.ink};white-space:nowrap;">${i.lineTotal}</td>
    </tr>`;
}

function sumRow(label: string, value: string, isTotal = false): string {
  if (isTotal) {
    return `
      <tr>
        <td style="padding:14px 0 0;border-top:1px solid ${E.rule};font-family:${E.font};font-size:24px;color:${E.ink};">${escapeHtml(label)}</td>
        <td align="right" style="padding:14px 0 0;border-top:1px solid ${E.rule};font-family:${E.font};font-size:24px;color:${E.ink};">${value}</td>
      </tr>`;
  }
  return `
    <tr>
      <td style="padding:6px 0;font-family:${E.mono};font-size:13px;font-weight:500;color:${E.ink2};letter-spacing:0.04em;">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;font-family:${E.mono};font-size:13px;font-weight:500;color:${E.ink2};letter-spacing:0.04em;">${value}</td>
    </tr>`;
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
    .map((l) => escapeHtml(l as string))
    .join('<br/>');
  return `
    <tr><td style="padding:8px 0 4px;"><span style="${labelStyle()}">Ships to</span></td></tr>
    <tr><td style="padding:0 0 32px;font-family:${E.font};font-size:15px;line-height:1.6;color:${E.ink2};">${lines}</td></tr>`;
}

export async function sendOrderConfirmation(data: OrderConfirmationData) {
  const orderRef = data.orderToken.slice(0, 8);
  const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
  const itemsHtml = data.items.map(rowItem).join('');
  const ship = shippingBlock(data.shippingAddress, data.customerName);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>Your Wildlight order</title>
</head>
<body style="margin:0;padding:0;background:${E.paper};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${E.paper};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${E.paper};">

        <tr><td style="padding:8px 0 24px;border-bottom:1px solid ${E.rule};">
          <span style="${labelStyle('letter-spacing:0.22em;')}">Wildlight Imagery</span>
        </td></tr>

        <tr><td style="padding:32px 0 8px;">
          <h1 style="font-family:${E.font};font-size:42px;font-weight:400;margin:0;letter-spacing:-0.01em;color:${E.ink};line-height:1.04;">Thank you<span style="color:${E.ink2};font-style:italic;">.</span></h1>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <span style="${labelStyle('letter-spacing:0.14em;')}">Order ${escapeHtml(orderRef)} · received</span>
        </td></tr>

        <tr><td style="padding-bottom:32px;font-family:${E.font};font-size:15px;line-height:1.6;color:${E.ink2};">
          Your order is in. Archival prints, made to order in Aurora, Colorado — usually shipping in 5–7 business days. We'll send a second email with tracking the moment it's on the way.
        </td></tr>

        <tr><td style="padding-bottom:8px;"><span style="${labelStyle()}">Plates</span></td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemsHtml}</table>
        </td></tr>

        <tr><td style="padding:32px 0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${E.paper2};border:1px solid ${E.rule};">
            <tr><td style="padding:24px 28px;">
              <span style="${labelStyle('letter-spacing:0.22em;display:block;margin-bottom:14px;')}">Receipt</span>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${sumRow('Subtotal', data.subtotal)}
                ${sumRow('Shipping', data.shipping)}
                ${sumRow('Tax', data.tax)}
                ${sumRow('Total', data.total, true)}
              </table>
            </td></tr>
          </table>
        </td></tr>

        ${ship}

        <tr><td style="padding:8px 0 32px;">
          <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 24px;background:${E.ink};color:${E.paper};text-decoration:none;font-family:${E.mono};font-size:11px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;">View order →</a>
        </td></tr>

        <tr><td style="padding:24px 0 0;border-top:1px solid ${E.rule};font-family:${E.font};font-size:12px;color:${E.ink3};line-height:1.6;">
          Wildlight Imagery — work by Dan Raby, Aurora, Colorado.<br/>
          Questions about your order? Just reply to this email.
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
  });
}

export async function sendOrderShipped(
  to: string,
  orderToken: string,
  trackingUrl: string | null,
  trackingNumber: string | null,
  siteUrl: string,
) {
  const tracking = trackingUrl
    ? `<p>Tracking: <a href="${trackingUrl}">${escapeHtml(trackingNumber || 'view')}</a></p>`
    : '<p>Tracking details to follow shortly.</p>';
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
      <h1 style="font-weight:400;">Your order has shipped.</h1>
      ${tracking}
      <p><a href="${siteUrl}/orders/${orderToken}">Order details</a></p>
    </div>`;
  return resend().emails.send({
    from: FROM,
    to,
    subject: 'Your Wildlight order has shipped',
    html,
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
