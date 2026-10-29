import type { Diagnosis, Priority } from '@prisma/client';
import { prisma, type Db } from '../repositories/prisma';
import { Errors } from '../utils/errors';

export const toCode = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export async function listCategories(includeInactive = false) {
  const rows = await prisma.category.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { tickets: true } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, ticketCount: _count.tickets }));
}

/** Throws a field-level 400 (mapped to the form) when a ticket uses a missing/disabled category. */
export async function assertActiveCategory(db: Db, code: string) {
  const c = await db.category.findUnique({ where: { code } });
  if (!c || !c.active) throw Errors.badRequest('Unknown or disabled category', [{ path: 'category', message: 'Choose an active category' }]);
  return c;
}

export async function createCategory(b: { name: string; description?: string | undefined; planTemplate?: Diagnosis | undefined; defaultPriority?: Priority | undefined }) {
  const code = toCode(b.name);
  if (code.length < 2) throw Errors.badRequest('Category name needs letters or digits', [{ path: 'name', message: 'Use at least 2 letters or digits' }]);
  const dup = await prisma.category.findFirst({ where: { OR: [{ code }, { name: { equals: b.name.trim(), mode: 'insensitive' } }] } });
  if (dup) throw Errors.conflict('CATEGORY_EXISTS', `A category named "${dup.name}" already exists`);
  const last = await prisma.category.aggregate({ _max: { sortOrder: true } });
  return prisma.category.create({
    data: {
      code, name: b.name.trim(), description: b.description?.trim() || null,
      planTemplate: b.planTemplate ?? 'UNKNOWN', defaultPriority: b.defaultPriority ?? 'MEDIUM', sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function updateCategory(code: string, b: { name?: string | undefined; description?: string | null | undefined; planTemplate?: Diagnosis | undefined; defaultPriority?: Priority | undefined; active?: boolean | undefined }) {
  const cur = await prisma.category.findUnique({ where: { code } });
  if (!cur) throw Errors.notFound('Category');
  if (b.name && b.name.trim().toLowerCase() !== cur.name.toLowerCase()) {
    const dup = await prisma.category.findFirst({ where: { name: { equals: b.name.trim(), mode: 'insensitive' }, NOT: { code } } });
    if (dup) throw Errors.conflict('CATEGORY_EXISTS', `A category named "${dup.name}" already exists`);
  }
  return prisma.category.update({
    where: { code },
    data: {
      ...(b.name !== undefined ? { name: b.name.trim() } : {}),
      ...(b.description !== undefined ? { description: b.description?.trim() || null } : {}),
      ...(b.planTemplate !== undefined ? { planTemplate: b.planTemplate } : {}),
      ...(b.defaultPriority !== undefined ? { defaultPriority: b.defaultPriority } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    },
  });
}

export async function deleteCategory(code: string) {
  const c = await prisma.category.findUnique({ where: { code }, include: { _count: { select: { tickets: true } } } });
  if (!c) throw Errors.notFound('Category');
  if (c.builtin) throw Errors.conflict('CATEGORY_BUILTIN', 'Built-in categories cannot be deleted. Disable it instead.');
  if (c._count.tickets > 0) throw Errors.conflict('CATEGORY_IN_USE', `${c._count.tickets} ticket(s) use this category. Disable it instead.`);
  await prisma.category.delete({ where: { code } });
}
