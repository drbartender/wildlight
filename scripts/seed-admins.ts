import { config } from 'dotenv';
import readline from 'node:readline/promises';
import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

config({ path: '.env.local' });

async function prompt(q: string, silent = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (silent) {
    const r = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    r._writeToOutput = function (s: string) {
      if (s.includes(q)) r.output.write(s);
      else r.output.write('*');
    };
  }
  const answer = await rl.question(q);
  rl.close();
  return answer.trim();
}

function argFor(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

async function main() {
  const argEmail = argFor('email');
  const argPass = argFor('password');
  const email = argEmail
    ? argEmail.toLowerCase()
    : (await prompt('Admin email: ')).toLowerCase();
  if (!email || !email.includes('@')) throw new Error('email required');
  const pass = argPass || (await prompt('Password (min 12 chars): ', true));
  if (pass.length < 12) throw new Error('password too short');
  const hash = await hashPassword(pass);
  const res = await pool.query(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [email, hash],
  );
  // eslint-disable-next-line no-console
  console.log('\nseeded:', res.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
