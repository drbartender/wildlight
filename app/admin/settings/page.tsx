import { pool } from '@/lib/db';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { PasswordForm } from './PasswordForm';
import { requireAdminOrRedirect } from '@/lib/session';
import { checkHealth, type HealthReport } from '@/lib/integration-health';

export const dynamic = 'force-dynamic';

interface AdminRow {
  email: string;
  role: string;
}

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PRINTFUL_API_KEY',
  'RESEND_API_KEY',
  'R2_ACCESS_KEY_ID',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
] as const;

function mask(key: string): { value: string; present: boolean } {
  const v = process.env[key];
  if (!v) return { value: '— missing —', present: false };
  if (v.length < 10) return { value: '••', present: true };
  return { value: `${v.slice(0, 4)}···${v.slice(-4)}`, present: true };
}

const INTEGRATIONS: { key: keyof HealthReport; label: string }[] = [
  { key: 'stripe', label: 'Stripe' },
  { key: 'printful', label: 'Printful' },
  { key: 'resend', label: 'Resend' },
  { key: 'r2', label: 'Cloudflare R2' },
  { key: 'webhooks', label: 'Webhooks' },
];

export default async function Settings() {
  const session = await requireAdminOrRedirect();
  const [health, admins] = await Promise.all([
    checkHealth(),
    pool
      .query<AdminRow>(`SELECT email, role FROM admin_users ORDER BY email ASC`)
      .catch(() => ({ rows: [] as AdminRow[] })),
  ]);

  return (
    <>
      <AdminTopBar title="Settings" subtitle="Account" />

      {/* Atelier layout */}
      <div
        className="wl-adm-page wl-adm-settings-atelier"
        style={{ maxWidth: 760 }}
      >
        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Change password</h3>
          <PasswordForm />
        </div>

        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Integrations</h3>
          <div className="wl-adm-integration-grid">
            {INTEGRATIONS.map((it) => {
              const h = health[it.key];
              return (
                <div
                  key={it.key}
                  className={`wl-adm-integration ${h.state === 'ok' ? 'ok' : 'miss'}`}
                >
                  <div className="h">
                    <strong>{it.label}</strong>
                    <span className="dot" aria-hidden="true" />
                  </div>
                  <div className="state">{h.note}</div>
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

      {/* Darkroom layout */}
      <div
        className="wl-adm-page wl-adm-settings-darkroom"
        style={{ maxWidth: 760 }}
      >
        <div className="wl-adm-panel" style={{ padding: 16 }}>
          <div className="wl-adm-settings-panel-h">change_password</div>
          <PasswordForm />
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">integrations</div>
          <table className="wl-adm-table mono">
            <tbody>
              {INTEGRATIONS.map((it) => {
                const h = health[it.key];
                return (
                  <tr key={it.key}>
                    <td style={{ color: 'var(--adm-ink)' }}>{it.key}</td>
                    <td className="muted">{h.note}</td>
                    <td
                      className="right"
                      style={{
                        color:
                          h.state === 'ok'
                            ? 'var(--adm-green)'
                            : h.state === 'warn'
                              ? 'var(--adm-amber)'
                              : 'var(--adm-red)',
                      }}
                    >
                      {h.state}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">env_vars</div>
          <div className="wl-adm-settings-panel-note">
            // read-only · rotate in vercel dashboard
          </div>
          <table
            className="wl-adm-table mono"
            style={{ marginTop: 10 }}
          >
            <tbody>
              {ENV_KEYS.map((k) => {
                const m = mask(k);
                return (
                  <tr key={k}>
                    <td style={{ color: 'var(--adm-ink)' }}>{k}</td>
                    <td className="muted">{m.value}</td>
                    <td
                      className="right"
                      style={{
                        color: m.present
                          ? 'var(--adm-green)'
                          : 'var(--adm-red)',
                        fontSize: 10,
                      }}
                    >
                      {m.present ? 'ok' : 'missing'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">
            admins [{admins.rows.length}]
          </div>
          <table
            className="wl-adm-table mono"
            style={{ marginTop: 10 }}
          >
            <tbody>
              {admins.rows.map((a) => (
                <tr key={a.email}>
                  <td style={{ color: 'var(--adm-ink)' }}>{a.email}</td>
                  <td style={{ color: 'var(--adm-green)' }}>{a.role}</td>
                  <td className="muted">
                    {a.email === session.email ? 'you · current session' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
