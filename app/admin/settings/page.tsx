import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

// Env-presence checks. No live API pings — just a quick "configured yes/no"
// so Dan can see at a glance whether a key has been set in Vercel.
const INTEGRATIONS: {
  key: string;
  label: string;
  vars: string[];
  noteKey?: string;
}[] = [
  {
    key: 'stripe',
    label: 'Stripe',
    vars: ['STRIPE_SECRET_KEY'],
    noteKey: 'STRIPE_SECRET_KEY',
  },
  {
    key: 'printful',
    label: 'Printful',
    vars: ['PRINTFUL_API_KEY'],
    noteKey: 'PRINTFUL_API_KEY',
  },
  {
    key: 'resend',
    label: 'Resend',
    vars: ['RESEND_API_KEY'],
    noteKey: 'RESEND_API_KEY',
  },
  {
    key: 'r2',
    label: 'Cloudflare R2',
    vars: [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_WEB',
      'R2_BUCKET_PRINT',
    ],
  },
];

function integrationState(vars: string[]): {
  ok: boolean;
  detail: string;
} {
  const present = vars.filter((v) => !!process.env[v]);
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length === 0) return { ok: true, detail: 'Configured' };
  if (present.length === 0) return { ok: false, detail: 'Not configured' };
  return {
    ok: false,
    detail: `Partial — missing ${missing.join(', ')}`,
  };
}

function maskedHint(key: string): string {
  const v = process.env[key];
  if (!v) return '';
  if (v.length < 10) return '••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export default function Settings() {
  return (
    <>
      <AdminTopBar title="Settings" subtitle="Account" />

      <div className="wl-adm-page" style={{ maxWidth: 760 }}>
        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Change password</h3>
          <PasswordForm />
        </div>

        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Integrations</h3>
          <div className="wl-adm-integration-grid">
            {INTEGRATIONS.map((it) => {
              const s = integrationState(it.vars);
              const hint = it.noteKey ? maskedHint(it.noteKey) : '';
              return (
                <div
                  key={it.key}
                  className={`wl-adm-integration ${s.ok ? 'ok' : 'miss'}`}
                >
                  <div className="h">
                    <strong>{it.label}</strong>
                    <span className="dot" aria-hidden="true" />
                  </div>
                  <div className="state">
                    {s.detail}
                    {hint ? ` · ${hint}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'var(--adm-muted)',
              marginTop: 14,
              lineHeight: 1.6,
            }}
          >
            API keys live in Vercel environment variables and are not editable
            here. Reach out to Dallas if a key needs to rotate.
          </p>
        </div>
      </div>
    </>
  );
}
