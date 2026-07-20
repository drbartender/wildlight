import { notFound } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { WallArranger } from '@/components/admin/WallArranger';
import type { LibraryPhoto } from '@/lib/wall-arrange';

export const dynamic = 'force-dynamic';

// DEV-ONLY visual harness for /admin/wall. Renders the real component inside
// the real admin shell with mock data at realistic scale (~100 photos), with no
// DB and no auth, so layout/interaction can be verified in a browser. Every
// mutation will 401 against the real API — that is fine and expected here; this
// harness is for LAYOUT and scale, not for exercising the write paths.
//
// Hard-gated off in production. Never link to it from the app.

const TITLES = [
  'Alpenglow, Study II', 'Tidewater', 'North Ridge', 'Larch Line', 'Sea Stack Fog',
  'Winter Aspens', 'Salt Creek', 'Meadow Storm', 'Granite Pool', 'Juniper Dusk',
  'Basalt Coast', 'Cottonwood Bend', 'Low Tide, Morning', 'Cirque Light', 'Ash Grove',
  'Quiet Water', 'The Long Field', 'Rimrock', 'Snowmelt', 'Harbor Dark',
];

// Deterministic placeholder image — no network dependency.
function img(i: number): string {
  const hue = (i * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">` +
    `<rect width="300" height="200" fill="hsl(${hue},38%,52%)"/>` +
    `<text x="150" y="110" font-family="sans-serif" font-size="34" fill="rgba(255,255,255,0.75)" text-anchor="middle">${i}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function mockPhotos(n: number): LibraryPhoto[] {
  const out: LibraryPhoto[] = [];
  for (let i = 1; i <= n; i++) {
    // ~28 on the wall (enough to overflow a capped shelf), ~14 in the shop,
    // ~20% with no print file, a couple published-but-not-buyable.
    const onWall = i <= 28;
    const hd = i % 5 !== 0;
    const published = hd && i % 7 === 0;
    const buyable = published && i % 21 !== 0;
    out.push({
      id: i,
      slug: `photo-${i}`,
      title: `${TITLES[i % TITLES.length]}${i > TITLES.length ? ` ${Math.ceil(i / TITLES.length)}` : ''}`,
      image_web_url: img(i),
      status: published ? 'published' : i % 11 === 0 ? 'retired' : 'draft',
      on_wall: onWall,
      updated_at: new Date(Date.UTC(2026, 6, 20) - i * 86400000).toISOString(),
      hd,
      buyable,
      price_from_cents: buyable ? 29000 + (i % 9) * 5000 : null,
      wall_rank: onWall ? i : null,
    });
  }
  return out;
}

export default async function DevWallPreview({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; n?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const sp = await searchParams;
  const theme = sp.theme === 'dark' ? 'dark' : 'light';
  const n = Math.min(Math.max(Number(sp.n) || 100, 1), 400);

  return (
    <div className="wl-admin-surface" data-theme={theme}>
      <AdminSidebar needsReview={3} email="dan@wildlightimagery.com" />
      <div className="wl-adm-main">
        <WallArranger photos={mockPhotos(n)} />
      </div>
    </div>
  );
}
