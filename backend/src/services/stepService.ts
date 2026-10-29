import type { Prisma, Skill } from '@prisma/client';
import { prisma, type Db } from '../repositories/prisma';
import type { AuthUser } from '../middleware/auth';
import { Errors } from '../utils/errors';
import { clock } from '../utils/clock';
import { computeForecast, type ForecastStep } from '../domain/forecast';
import { applyTransition, addHistory, lockTicket, refreshDerived, refreshAndPublish, publishTicket } from './ticketCore';
import { bus, rooms } from '../realtime/eventBus';

const stepInclude = {
  dependencies: true,
  assignee: { include: { user: { select: { name: true } } } },
} satisfies Prisma.WorkStepInclude;
type StepRow = Prisma.WorkStepGetPayload<{ include: typeof stepInclude }>;

const SATISFIED = ['DONE', 'SKIPPED'] as const;
const isSatisfied = (s: string) => (SATISFIED as readonly string[]).includes(s);

export async function listSteps(ticketId: string, db: Db = prisma) {
  const rows = await db.workStep.findMany({ where: { ticketId }, orderBy: { seq: 'asc' }, include: stepInclude });
  const fSteps: ForecastStep[] = rows.map((s) => ({
    id: s.id, status: s.status, estimatedMinutes: s.estimatedMinutes, actualMinutes: s.actualMinutes,
    startedAt: s.startedAt, dependsOn: s.dependencies.map((d) => d.dependsOnId),
  }));
  const forecast = computeForecast(fSteps, clock);
  return {
    steps: rows.map((s) => toStepDTO(s, forecast.steps[s.id])),
    forecast: { finish: forecast.forecastFinish, estimatedTotalMin: forecast.estimatedTotalMin, actualTotalMin: forecast.actualTotalMin },
  };
}

function toStepDTO(s: StepRow, f?: { etaMinutes: number; elapsedMinutes: number; overrunLevel: number; overrun: boolean }) {
  return {
    id: s.id, ticketId: s.ticketId, seq: s.seq, title: s.title, status: s.status,
    estimatedMinutes: s.estimatedMinutes, actualMinutes: s.actualMinutes, requiredSkill: s.requiredSkill,
    assigneeId: s.assigneeId, assigneeName: s.assignee?.user.name ?? null,
    startedAt: s.startedAt, completedAt: s.completedAt,
    dependsOn: s.dependencies.map((d) => d.dependsOnId), version: s.version,
    elapsedMinutes: f?.elapsedMinutes ?? 0, etaMinutes: f?.etaMinutes ?? 0,
    overrunLevel: f?.overrunLevel ?? 0, overrun: f?.overrun ?? false,
  };
}
export type StepDTO = ReturnType<typeof toStepDTO>;

/** Push the whole step list of a ticket (small) so clients just replace their copy. */
export async function publishSteps(ticketId: string, changedStepId?: string, extraType?: string) {
  const { steps, forecast } = await listSteps(ticketId);
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { technicianId: true } });
  const payload = { ticketId, steps, forecast, changedStepId: changedStepId ?? null };
  const deliveries = [
    { room: rooms.staff, payload }, { room: rooms.ticket(ticketId), payload },
    ...(t?.technicianId ? [{ room: rooms.tech(t.technicianId), payload }] : []),
  ];
  bus.publish('step.updated', deliveries);
  if (extraType) bus.publish(extraType, deliveries);
}

/** Can this actor work on steps of this ticket? (technicians: owner, step assignee or helper) */
async function assertCanWork(tx: Db, actor: AuthUser, ticket: { id: string; technicianId: string | null }, stepAssigneeId: string | null) {
  if (actor.role === 'SUPERVISOR' || actor.role === 'ADMIN') return;
  if (actor.role !== 'TECHNICIAN' || !actor.technicianId) throw Errors.forbidden();
  if (ticket.technicianId === actor.technicianId || stepAssigneeId === actor.technicianId) return;
  const helper = await tx.ticketAssignment.findFirst({ where: { ticketId: ticket.id, technicianId: actor.technicianId, role: 'HELPER', releasedAt: null } });
  if (!helper) throw Errors.forbidden('This ticket is not assigned to you');
}

/** Reject dependency graphs that contain a cycle (simple DFS). */
function assertAcyclic(edges: Map<string, string[]>) {
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) throw Errors.unprocessable('DEPENDENCY_CYCLE', 'Step dependencies must not form a cycle');
    state.set(n, 1);
    for (const d of edges.get(n) ?? []) visit(d);
    state.set(n, 2);
  };
  for (const n of edges.keys()) visit(n);
}

export interface NewStep {
  title: string;
  estimatedMinutes: number;
  dependsOn?: string[];
  requiredSkill?: Skill | undefined;
  assigneeId?: string | undefined;
  /** insert directly after this step and re-route the steps that were waiting for it */
  insertAfter?: string | undefined;
}

export async function createStepTx(tx: Db, ticketId: string, input: NewStep, actorId: string | null = null) {
  const deps = [...new Set(input.dependsOn ?? [])];
  const depRows = deps.length ? await tx.workStep.findMany({ where: { id: { in: deps }, ticketId } }) : [];
  if (depRows.length !== deps.length) throw Errors.badRequest('dependsOn must reference steps of the same ticket');
  const last = await tx.workStep.aggregate({ where: { ticketId }, _max: { seq: true } });
  const locked = depRows.some((d) => !isSatisfied(d.status));
  const step = await tx.workStep.create({
    data: {
      ticketId, seq: (last._max.seq ?? 0) + 1, title: input.title, estimatedMinutes: input.estimatedMinutes,
      requiredSkill: input.requiredSkill ?? null, assigneeId: input.assigneeId ?? null, status: locked ? 'LOCKED' : 'READY',
      dependencies: { create: deps.map((dependsOnId) => ({ dependsOnId })) },
    },
  });
  await addHistory(tx, { ticketId, entity: 'STEP', entityId: step.id, to: 'ADDED', message: `Step added: ${input.title} (${input.estimatedMinutes} min)`, actorId });
  return step;
}

/**
 * "Put this step right after step X": the new step waits for X, and every step that was waiting
 * for X (and has not started yet) now waits for the NEW step instead. Display numbers (seq) shift
 * so the list reads in the order the work will happen.
 */
export async function insertStepAfterTx(tx: Db, ticketId: string, afterId: string, input: NewStep, actorId: string | null = null) {
  const after = await tx.workStep.findFirst({ where: { id: afterId, ticketId } });
  if (!after) throw Errors.badRequest('insertAfter must be a step of this ticket', [{ path: 'insertAfter', message: 'Choose a step from this ticket' }]);
  const extra = [...new Set(input.dependsOn ?? [])].filter((d) => d !== afterId);
  const extraRows = extra.length ? await tx.workStep.findMany({ where: { id: { in: extra }, ticketId } }) : [];
  if (extraRows.length !== extra.length) throw Errors.badRequest('dependsOn must reference steps of the same ticket');

  const waiting = await tx.stepDependency.findMany({ where: { dependsOnId: afterId }, include: { step: true } }); // before the new step exists
  await tx.$executeRaw`UPDATE work_steps SET seq = seq + 1000 WHERE ticket_id = ${ticketId}::uuid AND seq > ${after.seq}`;
  await tx.$executeRaw`UPDATE work_steps SET seq = seq - 999 WHERE ticket_id = ${ticketId}::uuid AND seq > 1000`;

  const prereqs = [after, ...extraRows];
  const blocked = prereqs.some((d) => !isSatisfied(d.status));
  const created = await tx.workStep.create({
    data: {
      ticketId, seq: after.seq + 1, title: input.title, estimatedMinutes: input.estimatedMinutes,
      requiredSkill: input.requiredSkill ?? null, assigneeId: input.assigneeId ?? null, status: blocked ? 'LOCKED' : 'READY',
      dependencies: { create: [afterId, ...extra].map((dependsOnId) => ({ dependsOnId })) },
    },
  });
  for (const w of waiting) {
    if (w.step.status !== 'LOCKED' && w.step.status !== 'READY') continue; // already started or finished: leave alone
    await tx.stepDependency.delete({ where: { stepId_dependsOnId: { stepId: w.stepId, dependsOnId: afterId } } });
    await tx.stepDependency.create({ data: { stepId: w.stepId, dependsOnId: created.id } });
    if (blocked && w.step.status === 'READY') await tx.workStep.update({ where: { id: w.stepId }, data: { status: 'LOCKED', version: { increment: 1 } } });
  }
  await addHistory(tx, { ticketId, entity: 'STEP', entityId: created.id, to: 'ADDED', message: `Step added after #${after.seq}: ${input.title} (${input.estimatedMinutes} min)`, actorId });
  return created;
}

/** After a step becomes DONE/SKIPPED: dependants whose prerequisites are all satisfied become READY. */
async function unlockDependants(tx: Db, stepId: string): Promise<string[]> {
  const deps = await tx.stepDependency.findMany({ where: { dependsOnId: stepId }, select: { stepId: true } });
  const unlocked: string[] = [];
  for (const { stepId: sid } of deps) {
    const s = await tx.workStep.findUnique({ where: { id: sid }, include: { dependencies: { include: { dependsOn: { select: { status: true } } } } } });
    if (!s || s.status !== 'LOCKED') continue;
    if (s.dependencies.every((d) => isSatisfied(d.dependsOn.status))) {
      await tx.workStep.update({ where: { id: sid }, data: { status: 'READY', version: { increment: 1 } } });
      unlocked.push(sid);
    }
  }
  return unlocked;
}

const OPEN_FOR_WORK = ['ASSIGNED', 'IN_PROGRESS'] as const;

async function loadStep(tx: Db, id: string) {
  const s = await tx.workStep.findUnique({ where: { id }, include: { ticket: true } });
  if (!s) throw Errors.notFound('Step');
  return s;
}

export async function addStep(ticketId: string, input: NewStep, actor: AuthUser) {
  const step = await prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    if (['CLOSED', 'CANCELLED', 'RESOLVED'].includes(t.status)) throw Errors.unprocessable('TICKET_NOT_EDITABLE', `Cannot add steps to a ${t.status} ticket`);
    const s = input.insertAfter ? await insertStepAfterTx(tx, ticketId, input.insertAfter, input, actor.id) : await createStepTx(tx, ticketId, input, actor.id);
    await refreshDerived(tx, ticketId);
    return s;
  });
  await publishSteps(ticketId, step.id);
  await refreshAndPublish(ticketId, { force: true });
  return (await listSteps(ticketId)).steps.find((s) => s.id === step.id);
}

export async function patchStep(stepId: string, input: { title?: string | undefined; estimatedMinutes?: number | undefined; dependsOn?: string[] | undefined; assigneeId?: string | null | undefined; version: number }, actor: AuthUser) {
  const ticketId = await prisma.$transaction(async (tx) => {
    const s = await loadStep(tx, stepId);
    await lockTicket(tx, s.ticketId);
    if (s.version !== input.version) throw Errors.versionConflict();
    if (isSatisfied(s.status)) throw Errors.unprocessable('STEP_FINISHED', 'Finished steps cannot be edited');
    const data: Prisma.WorkStepUncheckedUpdateInput = { version: { increment: 1 } };
    if (input.title !== undefined) data.title = input.title;
    if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;

    if (input.dependsOn !== undefined) {
      if (s.status === 'IN_PROGRESS') throw Errors.unprocessable('STEP_RUNNING', 'Cannot change dependencies of a running step');
      const deps = [...new Set(input.dependsOn)];
      if (deps.includes(stepId)) throw Errors.unprocessable('DEPENDENCY_CYCLE', 'A step cannot depend on itself');
      const all = await tx.workStep.findMany({ where: { ticketId: s.ticketId }, include: { dependencies: true } });
      const ids = new Set(all.map((x) => x.id));
      if (!deps.every((d) => ids.has(d))) throw Errors.badRequest('dependsOn must reference steps of the same ticket');
      const edges = new Map(all.map((x) => [x.id, x.dependencies.map((d) => d.dependsOnId)]));
      edges.set(stepId, deps);
      assertAcyclic(edges);
      await tx.stepDependency.deleteMany({ where: { stepId } });
      await tx.stepDependency.createMany({ data: deps.map((dependsOnId) => ({ stepId, dependsOnId })) });
      const satisfied = all.filter((x) => deps.includes(x.id)).every((x) => isSatisfied(x.status));
      data.status = satisfied ? 'READY' : 'LOCKED';
    }
    await tx.workStep.update({ where: { id: stepId }, data });
    await addHistory(tx, { ticketId: s.ticketId, entity: 'STEP', entityId: stepId, to: 'EDITED', message: `Step edited: ${input.title ?? s.title}`, actorId: actor.id });
    await refreshDerived(tx, s.ticketId);
    return s.ticketId;
  });
  await publishSteps(ticketId, stepId);
  await refreshAndPublish(ticketId, { force: true });
  return (await listSteps(ticketId)).steps.find((s) => s.id === stepId);
}

export async function startStep(stepId: string, actor: AuthUser) {
  let startedTicketStatus = false;
  const { ticketId } = await prisma.$transaction(async (tx) => {
    const s = await loadStep(tx, stepId);
    const t = await lockTicket(tx, s.ticketId);
    await assertCanWork(tx, actor, { id: s.ticketId, technicianId: t.technicianId }, s.assigneeId);
    if (!(OPEN_FOR_WORK as readonly string[]).includes(t.status)) throw Errors.unprocessable('TICKET_NOT_ACTIVE', `Ticket is ${t.status}; work can only start when it is ASSIGNED or IN_PROGRESS`);
    if (s.status === 'LOCKED') throw Errors.stepLocked(); // dependency, not the clock, starts a step
    const owner = actor.technicianId ?? t.technicianId;
    const res = await tx.workStep.updateMany({
      where: { id: stepId, status: 'READY' },
      data: { status: 'IN_PROGRESS', startedAt: clock.now(), assigneeId: s.assigneeId ?? owner, version: { increment: 1 } },
    });
    if (res.count === 0) throw Errors.conflict('STEP_STATE_CONFLICT', `Step is already ${s.status}`);
    await addHistory(tx, { ticketId: s.ticketId, entity: 'STEP', entityId: stepId, from: 'READY', to: 'IN_PROGRESS', message: `Started: ${s.title}`, actorId: actor.id });
    if (t.status === 'ASSIGNED') {
      await applyTransition(tx, s.ticketId, 'IN_PROGRESS', { actorId: actor.id, message: 'Work started' });
      startedTicketStatus = true;
    }
    await refreshDerived(tx, s.ticketId);
    return { ticketId: s.ticketId };
  });
  await publishSteps(ticketId, stepId);
  await publishTicket(ticketId, startedTicketStatus ? 'ticket.status_changed' : 'ticket.updated', startedTicketStatus ? { from: 'ASSIGNED', to: 'IN_PROGRESS' } : {});
  return (await listSteps(ticketId)).steps.find((s) => s.id === stepId);
}

export async function completeStep(stepId: string, note: string | undefined, actor: AuthUser) {
  const { ticketId, unlocked } = await prisma.$transaction(async (tx) => {
    const s = await loadStep(tx, stepId);
    const t = await lockTicket(tx, s.ticketId);
    await assertCanWork(tx, actor, { id: s.ticketId, technicianId: t.technicianId }, s.assigneeId);
    if (s.status !== 'IN_PROGRESS' || !s.startedAt) throw Errors.conflict('STEP_STATE_CONFLICT', `Step is ${s.status}, not IN_PROGRESS`);
    const now = clock.now();
    const actual = Math.max(1, Math.ceil(clock.simMinutes(s.startedAt, now)));
    await tx.workStep.update({ where: { id: stepId }, data: { status: 'DONE', completedAt: now, actualMinutes: actual, version: { increment: 1 } } });
    const over = actual - s.estimatedMinutes;
    await addHistory(tx, {
      ticketId: s.ticketId, entity: 'STEP', entityId: stepId, from: 'IN_PROGRESS', to: 'DONE', actorId: actor.id,
      message: `Completed: ${s.title} - estimated ${s.estimatedMinutes} min, actual ${actual} min${over > 0 ? ` (+${over} min over)` : ''}${note ? `. Note: ${note}` : ''}`,
    });
    const unlocked = await unlockDependants(tx, stepId);
    await refreshDerived(tx, s.ticketId);
    return { ticketId: s.ticketId, unlocked };
  });
  await publishSteps(ticketId, stepId, unlocked.length ? 'step.unlocked' : undefined);
  await publishTicket(ticketId, 'ticket.updated', { reason: 'step_completed', unlocked });
  return (await listSteps(ticketId)).steps.find((s) => s.id === stepId);
}

export async function skipStep(stepId: string, actor: AuthUser) {
  const ticketId = await prisma.$transaction(async (tx) => {
    const s = await loadStep(tx, stepId);
    await lockTicket(tx, s.ticketId);
    if (s.status !== 'LOCKED' && s.status !== 'READY') throw Errors.conflict('STEP_STATE_CONFLICT', `Cannot skip a ${s.status} step`);
    await tx.workStep.update({ where: { id: stepId }, data: { status: 'SKIPPED', version: { increment: 1 } } });
    await addHistory(tx, { ticketId: s.ticketId, entity: 'STEP', entityId: stepId, from: s.status, to: 'SKIPPED', message: `Skipped: ${s.title}`, actorId: actor.id });
    await unlockDependants(tx, stepId);
    await refreshDerived(tx, s.ticketId);
    return s.ticketId;
  });
  await publishSteps(ticketId, stepId);
  await publishTicket(ticketId, 'ticket.updated', { reason: 'step_skipped' });
  return (await listSteps(ticketId)).steps.find((s) => s.id === stepId);
}

/** Used by the scheduler: flag steps that crossed 1.0x / 1.5x / 2.0x of their estimate. */
export async function detectOverruns(): Promise<number> {
  const running = await prisma.workStep.findMany({
    where: { status: 'IN_PROGRESS', startedAt: { not: null } },
    include: { ticket: { select: { id: true, number: true, technicianId: true } } },
  });
  let n = 0;
  for (const s of running) {
    const elapsed = clock.simMinutes(s.startedAt as Date);
    const ratio = elapsed / s.estimatedMinutes;
    const level = ratio >= 2 ? 3 : ratio >= 1.5 ? 2 : ratio >= 1 ? 1 : 0;
    if (level <= s.lastOverrunLevel) continue;
    const res = await prisma.workStep.updateMany({ where: { id: s.id, lastOverrunLevel: { lt: level } }, data: { lastOverrunLevel: level } });
    if (res.count === 0) continue; // another tick already reported it
    n++;
    const label = ['', '1.0x (estimate exceeded)', '1.5x', '2.0x'][level];
    await addHistory(prisma, { ticketId: s.ticketId, entity: 'SYSTEM', entityId: s.id, to: `OVERRUN_${level}`, message: `Overrun: "${s.title}" reached ${label} of its ${s.estimatedMinutes}-minute estimate` });
    const payload = {
      ticketId: s.ticketId, ticketNo: `TX-${s.ticket.number}`, stepId: s.id, title: s.title, level,
      multiple: [0, 1, 1.5, 2][level], estimatedMinutes: s.estimatedMinutes, elapsedMinutes: Math.round(elapsed),
      suggestion: level >= 3 ? 'Consider adding a helper or reassigning' : null,
    };
    bus.publish('step.overrun', [
      { room: rooms.staff, payload }, { room: rooms.ticket(s.ticketId), payload },
      ...(s.ticket.technicianId ? [{ room: rooms.tech(s.ticket.technicianId), payload }] : []),
    ]);
    await publishSteps(s.ticketId, s.id);
    await refreshAndPublish(s.ticketId, { force: true });
  }
  return n;
}
