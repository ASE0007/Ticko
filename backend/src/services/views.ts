import type { Prisma } from '@prisma/client';
import type { Db } from '../repositories/prisma';
import { prisma } from '../repositories/prisma';
import { Errors } from '../utils/errors';

export const ticketInclude = {
  customer: true,
  categoryRef: { select: { name: true } },
  technician: { include: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.TicketInclude;

export type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export const formatTicketNo = (n: number) => `TX-${n}`;

export function toTicketDTO(t: TicketRow) {
  return {
    id: t.id,
    number: t.number,
    ticketNo: formatTicketNo(t.number),
    title: t.title,
    description: t.description,
    category: t.category,
    categoryName: t.categoryRef.name,
    priority: t.priority,
    escalated: t.escalated,
    status: t.status,
    progress: t.progress,
    diagnosis: t.diagnosis,
    slaState: t.slaState,
    slaStartedAt: t.slaStartedAt,
    slaDeadline: t.slaDeadline,
    forecastFinish: t.forecastFinish,
    estimatedTotalMin: t.estimatedTotalMin,
    actualTotalMin: t.actualTotalMin,
    reopenCount: t.reopenCount,
    cancelReason: t.cancelReason,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    customer: {
      id: t.customer.id,
      accountNo: t.customer.accountNo,
      name: t.customer.name,
      phone: t.customer.phone,
      address: t.customer.address,
      area: t.customer.area,
      planMbps: t.customer.planMbps,
    },
    technician: t.technician
      ? {
          id: t.technician.id,
          name: t.technician.user.name,
          skills: t.technician.skills,
        }
      : null,
  };
}
export type TicketDTO = ReturnType<typeof toTicketDTO>;

/** What the customer may see on the public tracking page (no phone, no internal notes). */
export function toPublicTicketDTO(t: TicketRow) {
  return {
    ticketNo: formatTicketNo(t.number),
    title: t.title,
    category: t.category,
    categoryName: t.categoryRef.name,
    status: t.status,
    progress: t.progress,
    forecastFinish: t.forecastFinish,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    technicianFirstName: t.technician ? (t.technician.user.name.split(' ')[0] ?? null) : null,
    customerFirstName: t.customer.name.split(' ')[0] ?? '',
    planMbps: t.customer.planMbps,
  };
}

export async function loadTicket(id: string, db: Db = prisma): Promise<TicketRow> {
  const t = await db.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw Errors.notFound('Ticket');
  return t;
}

export const technicianInclude = { user: { select: { id: true, name: true, email: true } } } satisfies Prisma.TechnicianInclude;
export type TechRow = Prisma.TechnicianGetPayload<{ include: typeof technicianInclude }>;

export function toTechnicianDTO(t: TechRow) {
  return {
    id: t.id,
    userId: t.userId,
    name: t.user.name,
    email: t.user.email,
    skills: t.skills,
    availability: t.availability,
    activeTickets: t.activeTickets,
    maxActive: t.maxActive,
    atCapacity: t.activeTickets >= t.maxActive,
  };
}
export type TechnicianDTO = ReturnType<typeof toTechnicianDTO>;

export function toJobDTO(j: {
  id: string; ticketId: string | null; type: string; status: string; priorityRank: number; progress: number;
  stage: string | null; attempts: number; maxAttempts: number; error: string | null; createdAt: Date;
  startedAt: Date | null; finishedAt: Date | null; result?: unknown;
}) {
  return {
    id: j.id, ticketId: j.ticketId, type: j.type, status: j.status, priorityRank: j.priorityRank,
    progress: j.progress, stage: j.stage, attempts: j.attempts, maxAttempts: j.maxAttempts,
    error: j.error, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  };
}
export type JobDTO = ReturnType<typeof toJobDTO>;
