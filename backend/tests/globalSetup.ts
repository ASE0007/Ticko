import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { TEST_DB_URL } from './testEnv';

/** Fresh schema + all migrations (plain SQL, so no Prisma engine is needed). */
export default async function setup() {
  const url = new URL(TEST_DB_URL);
  url.searchParams.delete('schema');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const dir = path.join(__dirname, '..', 'prisma', 'migrations');
  const migrations = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
  for (const m of migrations) await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  await client.end();
}
