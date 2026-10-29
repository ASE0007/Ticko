import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import type { AuthUser } from '../middleware/auth';
import { Errors } from '../utils/errors';
import { clock } from '../utils/clock';
import { escalate, PRIORITY_RANK } from '../config/constants';
import { env } from '../config/env';
import { jobQueue } from '../queue/jobQueue';
import { addHistory, applyTransition, lockTicket, publishTicket, refreshDerived } from './ticketCore';
import { getPolicy } from './slaPolicy';
import { releaseCapacity } from './capacity';
import { createStepTx, listSteps, publishSteps } from './stepService';
import { publishTechnician } from './assignmentService';
import { loadTicket, ticketInclude, toJobDTO, toTicketDTO } from './views';
import { assertActiveCategory } from './categoryService';

type CreateInput = {
  customerId?: string | undefined;
  customer?: { name: string; phone: string; address: string; area?: string | undefined; planMbps: number } | undefined;
  title: string; description: string; category: never | string; priority: string;
};

export async function createTicket(input: CreateInput & { category: any; priority: any }, actor: AuthUser) {
  const policy = await getPolicy(input.priority);
  const created = await prisma.$transaction(async (tx) => {
    await assertActiveCategory(tx, input.category);
    let customerId = input.customerId;
    if (!customerId && input.customer) {
      const c = await tx.customer.create({
        data: { ...input.customer, area: input.customer.area ?? null, accountNo: `ACC-${randomBytes(3).toString('hex').toUpperCase()}` },
      });
      customerId = c.id;
    } else {
      const exists = await tx.customer.findUnique({ where: { id: customerId as string }, select: { id: true } });
      if (!exists) throw Errors.notFound('Customer');
    }
    const now = clock.now();
    const ticket = await tx.ticket.create({
      data: {
        customerId: customerId as string, createdById: actor.id, title: input.title, description: input.description,
        category: input.category, priority: input.priority, status: 'OPEN',
        createdAt: now, slaStartedAt: now, slaDeadline: clock.addSimMinutes(now, policy.resolutionMinutes),
        trackToken: randomBytes(24).toString('base64url'),
      },
    });
    await addHistory(tx, { ticketId: ticket.id, entity: 'TICKET', entityId: ticket.id, to: 'OPEN', message: 'Ticket created', actorId: actor.id });
    const job = await tx.job.create({
      data: { ticketId: ticket.id, type: 'DIAGNOSE_LINE', priorityRank: PRIORITY_RANK[input.priority as keyof typeof PRIORITY_RANK], requestedById: actor.id, createdAt: now },
    });
    return { ticket, job };
  });

  jobQueue.enqueue(created.job); // returns immediately; the worker pool does the long-running part
  const row = await publishTicket(created.ticket.id, 'ticket.created');
  return toTicketDTO(row);
}

/** Technician visibility: own tickets, tickets with a step assigned to them, or where they help. */
function technicianScope(actor: AuthUser): Prisma.TicketWhereInput {
  const tid = actor.technicianId ?? '00000000-0000-0000-0000-000000000000';
  return { OR: [{ technicianId: tid }, { steps: { some: { assigneeId: tid } } }, { assignments: { some: { technicianId: tid, role: 'HELPER', releasedAt: null } } }] };
}

export async function listTickets(q: any, actor: AuthUser) {
  const and: Prisma.TicketWhereInput[] = [];
  if (actor.role === 'TECHNICIAN') and.push(technicianScope(actor));
  if (q.mine && actor.technicianId) and.push({ technicianId: actor.technicianId });
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.priority?.length) and.push({ priority: { in: q.priority } });
  if (q.category?.length) and.push({ category: { in: q.category } });
  if (q.slaState?.length) and.push({ slaState: { in: q.slaState } });
  if (q.technicianId) and.push({ technicianId: q.technicianId });
  if (q.unassigned) and.push({ technicianId: null, status: { notIn: ['CLOSED', 'CANCELLED'] } });
  if (q.from) and.push({ createdAt: { gte: q.from } });
  if (q.to) and.push({ createdAt: { lte: q.to } });
  if (q.q) {
    const term: string = q.q;
    const num = /^(?:tx-?)?(\d{3,})$/i.exec(term);
    const or: Prisma.TicketWhereInput[] = [
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { customer: { name: { contains: term, mode: 'insensitive' } } },
      { customer: { phone: { contains: term } } },
      { customer: { accountNo: { contains: term, mode: 'insensitive' } } },
    ];
    if (num) or.push({ number: Number(num[1]) });
    and.push({ OR: or });
  }
  const where: Prisma.TicketWhereInput = and.length ? { AND: and } : {};
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ [q.sort]: q.order }, { number: 'desc' }];
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, include: ticketInclude }),
  ]);
  return { items: rows.map(toTicketDTO), page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
}

export async function assertCanView(actor: AuthUser, ticketId: string) {
  if (actor.role !== 'TECHNICIAN') return;
  const ok = await prisma.ticket.count({ where: { AND: [{ id: ticketId }, technicianScope(actor)] } });
  if (!ok) throw Errors.forbidden('This ticket is not assigned to you');
}

export async function getTicketDetail(id: string, actor: AuthUser) {
  await assertCanView(actor, id);
  const row = await loadTicket(id);
  const [{ steps, forecast }, jobs, assignments] = await Promise.all([
    listSteps(id),
    prisma.job.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.ticketAssignment.findMany({ where: { ticketId: id }, orderBy: { assignedAt: 'desc' }, include: { technician: { include: { user: { select: { name: true } } } } } }),
  ]);
  return {
    ticket: toTicketDTO(row),
    steps, forecast,
    jobs: jobs.map(toJobDTO),
    assignments: assignments.map((a) => ({ id: a.id, technicianId: a.technicianId, technicianName: a.technician.user.name, role: a.role, assignedAt: a.assignedAt, releasedAt: a.releasedAt, note: a.note })),
    trackToken: actor.role === 'TECHNICIAN' ? null : row.trackToken,
  };
}

export async function getTimeline(id: string, actor: AuthUser) {
  await assertCanView(actor, id);
  await loadTicket(id);
  const rows = await prisma.statusHistory.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, role: true } } } });
  return rows.map((r) => ({ id: r.id, entity: r.entity, from: r.fromValue, to: r.toValue, message: r.message, actor: r.actor?.name ?? 'System', actorRole: r.actor?.role ?? null, createdAt: r.createdAt }));
}

export async function updateTicket(id: string, body: any, actor: AuthUser) {
  await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, id);
    if (cur.version !== body.version) throw Errors.versionConflict();
    if (['CLOSED', 'CANCELLED', 'RESOLVED'].includes(cur.status)) throw Errors.unprocessable('TICKET_NOT_EDITABLE', `A ${cur.status} ticket cannot be edited`);
    const t = await tx.ticket.findUniqueOrThrow({ where: { id } });
    if (body.category !== undefined && body.category !== t.category) await assertActiveCategory(tx, body.category);
    const data: Prisma.TicketUncheckedUpdateInput = { version: { increment: 1 } };
    const changes: string[] = [];
    for (const k of ['title', 'description', 'category'] as const) {
      if (body[k] !== undefined && body[k] !== t[k]) { (data as any)[k] = body[k]; changes.push(k); }
    }
    if (body.priority && body.priority !== t.priority) {
      const policy = await getPolicy(body.priority);
      data.priority = body.priority;
      data.slaDeadline = clock.addSimMinutes(t.slaStartedAt, policy.resolutionMinutes);
      changes.push(`priority ${t.priority} -> ${body.priority}`);
    }
    await tx.ticket.update({ where: { id }, data });
    await addHistory(tx, { ticketId: id, entity: 'TICKET', entityId: id, to: 'EDITED', message: changes.length ? `Edited: ${changes.join(', ')}` : 'Edited', actorId: actor.id });
    await refreshDerived(tx, id);
  });
  return toTicketDTO(await publishTicket(id, 'ticket.updated', { reason: 'edited' }));
}

export async function cancelTicket(id: string, reason: string, actor: AuthUser) {
  const t0 = await loadTicket(id);
  if (actor.role === 'OPERATOR' && t0.createdById !== actor.id) throw Errors.forbidden('Operators can only cancel tickets they created');
  const released = await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, id);
    const wasOccupying = ['ASSIGNED', 'IN_PROGRESS', 'VERIFYING'].includes(cur.status);
    await applyTransition(tx, id, 'CANCELLED', { actorId: actor.id, message: `Cancelled: ${reason}`, data: { cancelReason: reason, closedAt: clock.now() } });
    if (cur.technicianId && wasOccupying) {
      await releaseCapacity(tx, cur.technicianId);
      await tx.ticketAssignment.updateMany({ where: { ticketId: id, releasedAt: null }, data: { releasedAt: clock.now() } });
    }
    await tx.workStep.updateMany({ where: { ticketId: id, status: { in: ['LOCKED', 'READY', 'IN_PROGRESS'] } }, data: { status: 'SKIPPED' } });
    await refreshDerived(tx, id);
    return wasOccupying ? cur.technicianId : null;
  });
  await jobQueue.cancelForTicket(id); // cooperative cancel of a running diagnostic/verification
  const row = await publishTicket(id, 'ticket.cancelled', { reason });
  await publishTicket(id, 'ticket.status_changed', { to: 'CANCELLED' }, { includeTrack: false });
  await publishSteps(id);
  if (released) await publishTechnician(released);
  return toTicketDTO(row);
}

/** Customer says it is fixed (operator on a call, tracking link, or auto-close). */
export async function closeTicket(id: string, actor: AuthUser | null, source: 'operator' | 'customer' | 'auto', note?: string) {
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, id, 'CLOSED', {
      actorId: actor?.id ?? null, data: { closedAt: clock.now() },
      message: source === 'customer' ? 'Customer confirmed the issue is fixed (tracking link)' : source === 'auto' ? `Auto-closed after ${env.AUTO_CLOSE_HOURS}h without customer response` : `Customer confirmed fixed${note ? `: ${note}` : ''}`,
    });
    await refreshDerived(tx, id);
  });
  const row = await publishTicket(id, 'ticket.closed', { source });
  await publishTicket(id, 'ticket.status_changed', { from: 'RESOLVED', to: 'CLOSED' }, { includeTrack: false });
  return toTicketDTO(row);
}

export async function reopenTicket(id: string, reason: string, actor: AuthUser | null, source: 'staff' | 'customer' = 'staff') {
  await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.findUniqueOrThrow({ where: { id } });
    const priority = escalate(t.priority);
    const policy = await getPolicy(priority);
    const now = clock.now();
    await applyTransition(tx, id, 'REOPENED', {
      actorId: actor?.id ?? null,
      message: `Reopened${source === 'customer' ? ' by customer' : ''}: ${reason}`,
      data: {
        reopenCount: { increment: 1 }, priority, technicianId: null, resolvedAt: null, closedAt: null, slaState: 'ON_TRACK',
        slaStartedAt: now, slaDeadline: clock.addSimMinutes(now, policy.resolutionMinutes), escalated: false,
      },
    });
    await createStepTx(tx, id, { title: 'Investigate recurring issue', estimatedMinutes: 30 }, actor?.id ?? null);
    await refreshDerived(tx, id);
  });
  const row = await publishTicket(id, 'ticket.reopened', { reason, source });
  await publishTicket(id, 'ticket.status_changed', { to: 'REOPENED' }, { includeTrack: false });
  await publishSteps(id);
  return toTicketDTO(row);
}
