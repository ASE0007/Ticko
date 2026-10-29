import { prisma } from '../repositories/prisma';
import type { AuthUser } from '../middleware/auth';
import { Errors } from '../utils/errors';
import { clock } from '../utils/clock';
import { assertTransition } from '../domain/ticketStateMachine';
import { DIAGNOSIS_SKILLS } from '../domain/workPlans';
import { addHistory, applyTransition, lockTicket, publishTicket, refreshDerived, refreshAndPublish } from './ticketCore';
import { releaseCapacity, reserveCapacity } from './capacity';
import { technicianInclude, toTechnicianDTO } from './views';
import { bus, rooms } from '../realtime/eventBus';
import { publishSteps } from './stepService';

export async function publishTechnician(technicianId: string) {
  const t = await prisma.technician.findUnique({ where: { id: technicianId }, include: technicianInclude });
  if (t) bus.publish('technician.updated', [{ room: rooms.staff, payload: { technician: toTechnicianDTO(t) } }]);
}

/**
 * Assign (or reassign) the PRIMARY owner of a ticket.
 * Concurrency: ticket row lock + version check + atomic capacity reservation + partial
 * unique index (one active primary per ticket). Two supervisors clicking at the same time
 * => exactly one succeeds, the other gets 409. Any failure rolls back the capacity slot too.
 */
export async function assignTicket(ticketId: string, input: { technicianId: string; version: number; note?: string | undefined }, actor: AuthUser) {
  const result = await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, ticketId);
    if (cur.version !== input.version) throw Errors.versionConflict();
    const reassign = cur.status === 'ASSIGNED' || cur.status === 'IN_PROGRESS';
    if (cur.technicianId === input.technicianId && reassign) throw Errors.alreadyAssigned();
    if (!reassign) {
      assertTransition(cur.status, 'ASSIGNED'); // only AWAITING_ASSIGNMENT / REOPENED
      if (cur.technicianId) throw Errors.alreadyAssigned();
    }
    await reserveCapacity(tx, input.technicianId);

    const tech = await tx.technician.findUniqueOrThrow({ where: { id: input.technicianId }, include: { user: { select: { name: true } } } });
    let previousTech: string | null = null;
    if (reassign && cur.technicianId) {
      previousTech = cur.technicianId;
      await releaseCapacity(tx, cur.technicianId);
      await tx.ticketAssignment.updateMany({ where: { ticketId, role: 'PRIMARY', releasedAt: null }, data: { releasedAt: clock.now() } });
      await tx.workStep.updateMany({ where: { ticketId, assigneeId: cur.technicianId, status: { in: ['LOCKED', 'READY', 'IN_PROGRESS'] } }, data: { assigneeId: input.technicianId } });
    }
    await tx.ticketAssignment.create({
      data: { ticketId, technicianId: input.technicianId, role: 'PRIMARY', assignedById: actor.id, note: input.note ?? null, assignedAt: clock.now() },
    });

    if (reassign) {
      await tx.ticket.update({ where: { id: ticketId }, data: { technicianId: input.technicianId, version: { increment: 1 } } });
      await addHistory(tx, { ticketId, entity: 'ASSIGNMENT', from: previousTech, to: input.technicianId, actorId: actor.id, message: `Reassigned to ${tech.user.name}` });
    } else {
      await applyTransition(tx, ticketId, 'ASSIGNED', { version: input.version, data: { technicianId: input.technicianId }, actorId: actor.id, message: `Assigned to ${tech.user.name}` });
      await addHistory(tx, { ticketId, entity: 'ASSIGNMENT', to: input.technicianId, actorId: actor.id, message: `Owner: ${tech.user.name}${input.note ? ` (${input.note})` : ''}` });
    }
    await refreshDerived(tx, ticketId);
    return { previousTech, reassign };
  });

  await publishTicket(ticketId, 'ticket.assigned', { technicianId: input.technicianId, reassigned: result.reassign });
  if (!result.reassign) await publishTicket(ticketId, 'ticket.status_changed', { from: 'AWAITING_ASSIGNMENT', to: 'ASSIGNED' });
  await publishTechnician(input.technicianId);
  if (result.previousTech) await publishTechnician(result.previousTech);
  await publishSteps(ticketId);
  await refreshAndPublish(ticketId);
}

export async function addHelper(ticketId: string, technicianId: string, actor: AuthUser) {
  await prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    if (['CLOSED', 'CANCELLED', 'RESOLVED'].includes(t.status)) throw Errors.unprocessable('TICKET_NOT_EDITABLE', 'Ticket is finished');
    if (t.technicianId === technicianId) throw Errors.conflict('ALREADY_OWNER', 'This technician is already the owner');
    const tech = await tx.technician.findUnique({ where: { id: technicianId }, include: { user: { select: { name: true } } } });
    if (!tech) throw Errors.notFound('Technician');
    const dup = await tx.ticketAssignment.findFirst({ where: { ticketId, technicianId, role: 'HELPER', releasedAt: null } });
    if (dup) throw Errors.conflict('ALREADY_HELPER', 'Technician is already a helper');
    await tx.ticketAssignment.create({ data: { ticketId, technicianId, role: 'HELPER', assignedById: actor.id, assignedAt: clock.now() } });
    await addHistory(tx, { ticketId, entity: 'ASSIGNMENT', to: technicianId, actorId: actor.id, message: `Helper added: ${tech.user.name}` });
  });
  await publishTicket(ticketId, 'ticket.updated', { reason: 'helper_added' });
}

/** Ranked technician suggestions: skill fit + free capacity + availability (FR-15). */
export async function suggestTechnicians(ticketId: string) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { steps: { select: { requiredSkill: true, status: true } } } });
  if (!t) throw Errors.notFound('Ticket');
  const wanted = t.diagnosis ? DIAGNOSIS_SKILLS[t.diagnosis] : [];
  const stepSkills = t.steps.filter((s) => s.status !== 'DONE' && s.requiredSkill).map((s) => s.requiredSkill);
  const techs = await prisma.technician.findMany({ include: technicianInclude });
  const ranked = techs.map((tech) => {
    const reasons: string[] = [];
    let score = 0;
    const matched = wanted.filter((s) => tech.skills.includes(s));
    if (matched.length) { score += 40 * matched.length; reasons.push(`Skills match diagnosis: ${matched.join(', ')}`); }
    const coverage = stepSkills.filter((s) => s && tech.skills.includes(s)).length;
    if (coverage) { score += 5 * coverage; reasons.push(`Covers ${coverage} planned step(s)`); }
    const free = tech.maxActive - tech.activeTickets;
    score += Math.max(0, free) * 15;
    reasons.push(free > 0 ? `${free} free slot(s)` : 'At capacity');
    if (tech.availability === 'AVAILABLE') score += 10;
    if (tech.availability === 'OFF_DUTY') { score -= 100; reasons.push('Off duty'); }
    return { technician: toTechnicianDTO(tech), score, reasons, canAssign: free > 0 && tech.availability !== 'OFF_DUTY' };
  });
  return ranked.sort((a, b) => b.score - a.score);
}

export async function listTechnicians() {
  const techs = await prisma.technician.findMany({
    include: { ...technicianInclude, tickets: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'VERIFYING'] } }, select: { id: true, number: true, title: true, status: true, priority: true, progress: true, slaState: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return techs.map((t) => ({
    ...toTechnicianDTO(t),
    currentTickets: t.tickets.map((x) => ({ id: x.id, ticketNo: `TX-${x.number}`, title: x.title, status: x.status, priority: x.priority, progress: x.progress, slaState: x.slaState })),
  }));
}

export async function setAvailability(technicianId: string, availability: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY', actor: AuthUser) {
  if (actor.role === 'TECHNICIAN' && actor.technicianId !== technicianId) throw Errors.forbidden();
  const t = await prisma.technician.update({ where: { id: technicianId }, data: { availability }, include: technicianInclude }).catch(() => null);
  if (!t) throw Errors.notFound('Technician');
  bus.publish('technician.updated', [{ room: rooms.staff, payload: { technician: toTechnicianDTO(t) } }]);
  return toTechnicianDTO(t);
}
