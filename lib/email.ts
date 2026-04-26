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
  items: Array<{
    title: string;
    variant: string;
    price: string;
    qty: number;
    image_url?: string;
  }>;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  siteUrl: string;
}

export async function sendOrderConfirmation(data: OrderConfirmationData) {
  const itemsHtml = data.items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0;">${escapeHtml(i.title)} — ${escapeHtml(i.variant)}</td>` +
        `<td style="padding:4px 8px;">×${i.qty}</td>` +
        `<td style="padding:4px 0;text-align:right;">${i.price}</td></tr>`,
    )
    .join('');
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
      <h1 style="font-weight:400;">Thank you.</h1>
      <p>Your order has been received. We'll send a second email with tracking once it ships.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">${itemsHtml}</table>
      <p>Subtotal: ${data.subtotal}<br/>Shipping: ${data.shipping}<br/>Tax: ${data.tax}<br/><strong>Total: ${data.total}</strong></p>
      <p><a href="${data.siteUrl}/orders/${data.orderToken}">View order status</a></p>
      <hr style="margin-top:32px;border:none;border-top:1px solid #eee;"/>
      <p style="color:#777;font-size:12px;">Wildlight Imagery — work by Dan Raby</p>
    </div>`;
  return resend().emails.send({ from: FROM, to: data.to, subject: 'Your Wildlight order', html });
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
