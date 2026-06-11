// Read-only: what print sizes are actually offered (and at what DPI) per artwork.
import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await client.connect();

// long-edge inches per size label
const LONG = { '8x10': 10, '12x16': 16, '16x20': 20, '18x24': 24, '24x30': 30, '24x36': 36 };

// 1) Distinct sizes offered across the whole catalog, and how many variants each.
const sizes = await client.query(`
  SELECT type, size, COUNT(*) AS variants,
         COUNT(*) FILTER (WHERE a.status='published') AS on_published
  FROM artwork_variants v JOIN artworks a ON a.id = v.artwork_id
  GROUP BY type, size ORDER BY type, size
`);
console.log('Variants offered across catalog (type / size / total / on published artworks):');
for (const r of sizes.rows) {
  console.log(`  ${r.type.padEnd(7)} ${r.size.padEnd(7)}  total=${String(r.variants).padStart(4)}  on_published=${r.on_published}`);
}

// 2) For published artworks WITH measured print dims: biggest offered size vs its DPI.
const pub = await client.query(`
  SELECT a.id, a.title, a.print_width, a.print_height,
         array_agg(DISTINCT v.size) AS sizes
  FROM artworks a JOIN artwork_variants v ON v.artwork_id = a.id
  WHERE a.status='published'
  GROUP BY a.id, a.title, a.print_width, a.print_height
  ORDER BY a.id
`);
console.log('\nPublished artworks — offered sizes vs print resolution:');
console.log(' id  print W×H        offered sizes                          worst-DPI');
console.log('─'.repeat(92));
for (const r of pub.rows) {
  const le = r.print_width && r.print_height ? Math.max(r.print_width, r.print_height) : null;
  const offered = (r.sizes || []).filter(Boolean).sort();
  const biggestInch = Math.max(...offered.map((s) => LONG[s] || 0), 0);
  const dpi = le && biggestInch ? Math.round(le / biggestInch) : null;
  const pdims = le ? `${r.print_width}×${r.print_height}` : 'UNMEASURED';
  console.log(
    `${String(r.id).padStart(3)}  ${pdims.padEnd(15)}  ${offered.join(',').padEnd(38)}  ${dpi == null ? '?' : dpi + ' DPI'}`,
  );
}

await client.end();
