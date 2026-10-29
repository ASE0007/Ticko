import { prisma } from '../repositories/prisma';
import type { AuthUser } from '../middleware/auth';
import { Errors } from '../utils/errors';
import { simulationOverridesEnabled } from '../config/env';
import { PRIORITY_RANK } from '../config/constants';
import { jobQueue } from '../queue/jobQueue';
import { applyTransition, lockTicket, publishTicket, refreshDerived } from './ticketCore';

/** Technician says "I'm done": move to VERIFYING and queue the automatic speed-test job. */
export async function requestVerification(ticketId: string, simulate: 'PASS' | 'FAIL' | undefined, actor: AuthUser) {
  if (simulate && !simulationOverridesEnabled) throw Errors.forbidden('Simulation overrides are disabled');
  const job = await prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    if (actor.role === 'TECHNICIAN' && t.technicianId !== actor.technicianId) throw Errors.forbidden('Only the ticket owner can request verification');
    const open = await tx.workStep.count({ where: { ticketId, status: { in: ['LOCKED', 'READY', 'IN_PROGRESS'] } } });
    if (open > 0) throw Errors.unprocessable('STEPS_INCOMPLETE', `${open} work step(s) are not finished yet`);
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { priority: true } });
    await applyTransition(tx, ticketId, 'VERIFYING', { actorId: actor.id, message: 'Technician finished work; automatic speed verification requested' });
    const j = await tx.job.create({
      data: { ticketId, type: 'VERIFY_SPEED', priorityRank: PRIORITY_RANK[ticket.priority], requestedById: actor.id, payload: simulate ? { simulate } : {} },
    });
    await refreshDerived(tx, ticketId, { jobProgress: 0 });
    return j;
  });
  jobQueue.enqueue(job);
  await publishTicket(ticketId, 'ticket.status_changed', { from: 'IN_PROGRESS', to: 'VERIFYING' });
  return { jobId: job.id };
}
