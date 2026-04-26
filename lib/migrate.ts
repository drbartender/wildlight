import './load-env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from './db';

async function main() {
  const sqlPath = resolve(process.cwd(), 'lib/schema.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('schema applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
