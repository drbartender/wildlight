// Side-effect import: loads .env.local before any module that reads
// process.env at import time (e.g. lib/db.ts, which captures
// DATABASE_URL when the pool is constructed). Import this FIRST in CLI
// entrypoints — Vercel and other CI runners inject env at the OS level
// and dotenv silently no-ops when .env.local is absent.
import { config } from 'dotenv';
config({ path: '.env.local' });
