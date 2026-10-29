import { randomBytes } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { Errors } from '../utils/errors';

type CustomerInput = { name: string; phone: string; address: string; area?: string | undefined; planMbps: number };

const withCount = { _count: { select: { tickets: true } } } as const;
const toDto = <T extends { _count: { tickets: number } }>({ _count, ...c }: T) => ({ ...c, ticketCount: _count.tickets });

/** Search by name / phone / account number. `limit` is capped so the page stays fast. */
export async function listCustomers(q: string | undefined, limit = 20) {
  const rows = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { accountNo: { contains: q, mode: 'insensitive' } }] } : {},
    orderBy: { name: 'asc' }, take: Math.min(Math.max(limit, 1), 200), include: withCount,
  });
  return rows.map(toDto);
}

/** Register a customer ahead of time, so an operator can pick them later when a ticket is filed. */
export async function createCustomer(input: CustomerInput) {
  const dup = await prisma.customer.findFirst({ where: { phone: input.phone } });
  if (dup) throw Errors.conflict('CUSTOMER_EXISTS', `A customer with this phone number already exists: ${dup.name} (${dup.accountNo})`);
  const c = await prisma.customer.create({
    data: { ...input, area: input.area || null, accountNo: `ACC-${randomBytes(3).toString('hex').toUpperCase()}` },
    include: withCount,
  });
  return toDto(c);
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw Errors.notFound('Customer');
  if (input.phone && input.phone !== cur.phone) {
    const dup = await prisma.customer.findFirst({ where: { phone: input.phone, NOT: { id } } });
    if (dup) throw Errors.conflict('CUSTOMER_EXISTS', `A customer with this phone number already exists: ${dup.name} (${dup.accountNo})`);
  }
  const c = await prisma.customer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.area !== undefined ? { area: input.area || null } : {}),
      ...(input.planMbps !== undefined ? { planMbps: input.planMbps } : {}),
    },
    include: withCount,
  });
  return toDto(c);
}
