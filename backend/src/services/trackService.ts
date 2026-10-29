import { prisma } from '../repositories/prisma';
import { Errors } from '../utils/errors';
import { closeTicket, reopenTicket } from './ticketService';
import { toPublicTicketDTO, ticketInclude } from './views';

async function byToken(token: string) {
  const t = await prisma.ticket.findUnique({ where: { trackToken: token }, include: ticketInclude });
  if (!t) throw Errors.notFound('Tracking link');
  return t;
}

export async function getTracking(token: string) {
  const t = await byToken(token);
  const history = await prisma.statusHistory.findMany({ where: { ticketId: t.id, entity: 'TICKET' }, orderBy: { createdAt: 'asc' }, select: { toValue: true, createdAt: true } });
  const customerCanRespond = t.status === 'RESOLVED';
  return {
    ticket: toPublicTicketDTO(t),
    timeline: history.map((h) => ({ status: h.toValue, at: h.createdAt })),
    customerCanRespond,
  };
}

export async function confirmByToken(token: string) {
  const t = await byToken(token);
  if (t.status !== 'RESOLVED') throw Errors.unprocessable('NOT_AWAITING_CONFIRMATION', 'This ticket is not waiting for your confirmation');
  await closeTicket(t.id, null, 'customer');
  return { ok: true };
}

export async function reportIssueByToken(token: string, note?: string) {
  const t = await byToken(token);
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw Errors.unprocessable('NOT_RESOLVED', 'This ticket has not been resolved yet');
  await reopenTicket(t.id, note?.trim() || 'Customer reports the problem still exists', null, 'customer');
  return { ok: true };
}
