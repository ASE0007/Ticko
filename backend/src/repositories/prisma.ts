import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

function buildAdapter() {
  // pg does not understand Prisma's ?schema= parameter, so split it out.
  const url = new URL(env.DATABASE_URL);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  return new PrismaPg({ connectionString: url.toString(), max: 15 }, { schema });
}

/** Single shared client (connection pool) for the process. */
export const prisma = new PrismaClient({ adapter: buildAdapter(), log: ['error'] });

/** Either the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
