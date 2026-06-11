// Read-only audit: how big are the uploaded print masters, and what DPI do
// they yield at the largest sizes Wildlight actually sells?
// Run:  npx dotenv -e .env.local -- node scripts/check-print-res.mjs
import 'dotenv/config';
import pg from 'pg';

// Largest print sizes offered (long edge inches) from lib/variant-templates.ts
const SIZES = [
  ['8x10', 10],
  ['12x16', 16],
  ['16x20', 20], // metal
  ['18x24', 24],
  ['24x30', 30], // metal
  ['24x36', 36], // biggest paper/canvas/framed
];
const BIGGEST_LONG_EDGE = 36;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await client.connect();

const { rows } = await client.query(`
  SELECT id, title, slug, status,
         (image_print_url IS NOT NULL AND image_print_url <> '') AS has_print,
         print_width, print_height,
         image_width AS web_w, image_height AS web_h
  FROM artworks
  ORDER BY status, id
`);

const fmt = (n) => (n == null ? '—' : String(n));
const longEdge = (r) =>
  r.print_width && r.print_height ? Math.max(r.print_width, r.print_height) : null;

// DPI ratings (rough industry consensus for wall art viewed at arm's length+)
//   >=300 excellent · 240–299 great · 180–239 good · 150–179 acceptable · <150 soft
function grade(dpi) {
  if (dpi == null) return '?';
  if (dpi >= 300) return 'EXCELLENT';
  if (dpi >= 240) return 'great';
  if (dpi >= 180) return 'good';
  if (dpi >= 150) return 'ok';
  return 'SOFT';
}

let withPrint = 0,
  noPrint = 0,
  soft36 = 0;

console.log(
  '\n id  status      print W×H        long-edge  DPI@36"  verdict   web W×H        title',
);
console.log('─'.repeat(110));
for (const r of rows) {
  const le = longEdge(r);
  if (r.has_print && le) withPrint++;
  else noPrint++;
  const dpi36 = le ? Math.round(le / BIGGEST_LONG_EDGE) : null;
  if (dpi36 != null && dpi36 < 150) soft36++;
  const pdims = r.print_width ? `${r.print_width}×${r.print_height}` : '—';
  const wdims = r.web_w ? `${r.web_w}×${r.web_h}` : '—';
  console.log(
    `${String(r.id).padStart(3)}  ${r.status.padEnd(10)}  ${pdims.padEnd(15)}  ${fmt(le).padStart(8)}   ${fmt(dpi36).padStart(5)}   ${grade(dpi36).padEnd(9)} ${wdims.padEnd(13)}  ${r.title}`,
  );
}

console.log('─'.repeat(110));
console.log(
  `\nTotal artworks: ${rows.length}  |  with print master + dims: ${withPrint}  |  missing print/dims: ${noPrint}  |  soft at 24×36 (<150 DPI): ${soft36}`,
);

// Per-size summary: how many masters clear each DPI bar at each offered size.
console.log('\nHow many of the', withPrint, 'masters clear 150 / 240 / 300 DPI at each offered size:');
for (const [label, inch] of SIZES) {
  let ok150 = 0,
    ok240 = 0,
    ok300 = 0;
  for (const r of rows) {
    const le = longEdge(r);
    if (!le) continue;
    const dpi = le / inch;
    if (dpi >= 150) ok150++;
    if (dpi >= 240) ok240++;
    if (dpi >= 300) ok300++;
  }
  console.log(
    `  ${label.padEnd(6)} (${String(inch).padStart(2)}" long): ` +
      `${String(ok150).padStart(3)} ≥150   ${String(ok240).padStart(3)} ≥240   ${String(ok300).padStart(3)} ≥300`,
  );
}

await client.end();
