// Quick read-only sanity check on order_items left orphaned by the
// cleanup-no-print-master cleanup. Each row should still have its
// artwork_snapshot/variant_snapshot intact even though variant_id is
// NULL.
import { pool } from '@/lib/db';

async function main() {
  const r = await pool.query<{
    order_id: number;
    item_id: number;
    is_test: boolean;
    order_status: string;
    artwork_title: string;
    variant_label: string;
    has_snapshots: boolean;
  }>(`
    SELECT
      oi.order_id,
      oi.id AS item_id,
      o.is_test,
      o.status AS order_status,
      oi.artwork_snapshot->>'title' AS artwork_title,
      COALESCE(oi.variant_snapshot->>'size', '') ||
        COALESCE(' / ' || (oi.variant_snapshot->>'finish'), '') AS variant_label,
      (oi.artwork_snapshot IS NOT NULL AND oi.variant_snapshot IS NOT NULL) AS has_snapshots
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.variant_id IS NULL
    ORDER BY oi.order_id, oi.id
  `);

  console.log(`Order items now with variant_id=NULL: ${r.rowCount}`);
  for (const row of r.rows) {
    console.log(
      `  order=${row.order_id} item=${row.item_id} test=${row.is_test} status=${row.order_status} snapshots=${row.has_snapshots} | ${row.artwork_title} — ${row.variant_label}`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
