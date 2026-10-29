import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { Diagnosis, Job } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { clock } from '../utils/clock';
import { abortError } from '../utils/sleep';
import { logger } from '../utils/logger';
import { probe, simulateFault, seeded, round } from '../probe/simulatedProbe';
import { WORK_PLANS } from '../domain/workPlans';
import { applyTransition, lockTicket, publishTicket, refreshDerived, addHistory } from '../services/ticketCore';
import { createStepTx } from '../services/stepService';
import { publishSteps } from '../services/stepService';
import { releaseCapacity } from '../services/capacity';
import { publishTechnician } from '../services/assignmentService';
import { bus, rooms } from '../realtime/eventBus';
import { jobQueue, type JobContext } from './jobQueue';

// ───────────────────────── DIAGNOSE_LINE ─────────────────────────

const DIAGNOSE_STAGES = [
  { name: 'LINE_SYNC', label: 'Checking line sync', pct: 20 },
  { name: 'OPTICAL_POWER', label: 'Measuring optical signal', pct: 40 },
  { name: 'PACKET_LOSS_LATENCY', label: 'Testing packet loss & latency', pct: 60 },
  { name: 'SPEED_PROFILE', label: 'Comparing speed profile to plan', pct: 80 },
] as const;

async function diagnoseLine(ctx: JobContext) {
  const ticketId = ctx.job.ticketId as string;
  const t0 = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { customer: true, categoryRef: true } });
  if (!t0 || t0.status === 'CANCELLED') throw abortError();
  const probeCtx = { ticketId, category: t0.category, planTemplate: t0.categoryRef.planTemplate, planMbps: t0.customer.planMbps };

  if (t0.status === 'OPEN') {
    await prisma.$transaction((tx) => applyTransition(tx, ticketId, 'DIAGNOSING', { message: 'Automatic line diagnostics started' }));
    await publishTicket(ticketId, 'ticket.status_changed', { from: 'OPEN', to: 'DIAGNOSING' });
  }
  await ctx.progress(2, 'Starting diagnostics');

  const results = [];
  for (const stage of DIAGNOSE_STAGES) {
    const r = await probe.runCheck(stage.name, probeCtx, ctx.signal);
    results.push(r);
    await prisma.probeResult.create({ data: { jobId: ctx.job.id, checkName: stage.name, passed: r.passed, metrics: r.metrics } });
    await ctx.progress(stage.pct, stage.label);
  }

  const diagnosis: Diagnosis = simulateFault(probeCtx);
  await ctx.progress(95, 'Classifying fault & building work plan');
  const stepCount = await finalizeDiagnosis(ticketId, diagnosis);
  await ctx.progress(100, 'Diagnosis complete');
  return { diagnosis, stepsCreated: stepCount, checks: results.map((r) => ({ stage: r.stage, passed: r.passed, ...r.metrics })) };
}

async function finalizeDiagnosis(ticketId: string, diagnosis: Diagnosis): Promise<number> {
  const created = await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, ticketId);
    if (cur.status !== 'DIAGNOSING') throw abortError(); // cancelled while we were working
    let n = await tx.workStep.count({ where: { ticketId } });
    if (n === 0) {
      // idempotent: a retried job never duplicates the plan
      const ids: string[] = [];
      const plan = WORK_PLANS[diagnosis];
      for (const p of plan) {
        const s = await createStepTx(tx, ticketId, { title: p.title, estimatedMinutes: p.estimatedMinutes, requiredSkill: p.skill, dependsOn: p.dependsOn.map((i) => ids[i] as string) });
        ids.push(s.id);
      }
      n = plan.length;
    }
    await applyTransition(tx, ticketId, 'AWAITING_ASSIGNMENT', { data: { diagnosis }, message: `Diagnosis: ${diagnosis.replace('_', ' ')}. Work plan generated (${n} steps).` });
    await refreshDerived(tx, ticketId, { jobProgress: 100 });
    return n;
  });
  await publishTicket(ticketId, 'ticket.status_changed', { from: 'DIAGNOSING', to: 'AWAITING_ASSIGNMENT' });
  await publishSteps(ticketId);
  return created;
}

async function diagnoseFinalFailure(job: Job) {
  if (!job.ticketId) return;
  // Fall back to manual triage with a generic plan so the ticket is never stuck (FR-34)
  await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, job.ticketId as string);
    if (cur.status !== 'OPEN' && cur.status !== 'DIAGNOSING') return;
    if ((await tx.workStep.count({ where: { ticketId: job.ticketId as string } })) === 0) {
      const ids: string[] = [];
      for (const p of WORK_PLANS.UNKNOWN) {
        const s = await createStepTx(tx, job.ticketId as string, { title: p.title, estimatedMinutes: p.estimatedMinutes, requiredSkill: p.skill, dependsOn: p.dependsOn.map((i) => ids[i] as string) });
        ids.push(s.id);
      }
    }
    await applyTransition(tx, job.ticketId as string, 'AWAITING_ASSIGNMENT', { data: { diagnosis: 'UNKNOWN' }, message: 'Automatic diagnostics failed; manual triage required' });
  });
  await publishTicket(job.ticketId, 'ticket.status_changed', { to: 'AWAITING_ASSIGNMENT' });
  await publishSteps(job.ticketId);
  bus.publish('job.alert', [{ room: rooms.staff, payload: { ticketId: job.ticketId, message: 'Diagnostics failed - manual triage required' } }]);
}

// ───────────────────────── VERIFY_SPEED ─────────────────────────

const VERIFY_STAGES = [
  { name: 'CONNECT', label: 'Connecting to customer line', pct: 15 },
  { name: 'DOWNLOAD_TEST', label: 'Running download test', pct: 45 },
  { name: 'UPLOAD_TEST', label: 'Running upload test', pct: 70 },
  { name: 'LATENCY', label: 'Measuring latency', pct: 85 },
] as const;

async function verifySpeed(ctx: JobContext) {
  const ticketId = ctx.job.ticketId as string;
  const t0 = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { customer: true, categoryRef: true } });
  if (!t0 || t0.status !== 'VERIFYING') throw abortError();
  const plan = t0.customer.planMbps;
  const simulate = (ctx.job.payload as { simulate?: 'PASS' | 'FAIL' } | null)?.simulate;
  const rnd = seeded(`${ticketId}:${ctx.job.attempts}:${Date.now() >> 12}`);
  const pass = simulate ? simulate === 'PASS' : rnd() < 0.85;
  const measured = round(plan * (pass ? 0.9 + rnd() * 0.15 : 0.35 + rnd() * 0.35));
  const probeCtx = { ticketId, category: t0.category, planTemplate: t0.categoryRef.planTemplate, planMbps: plan };

  await ctx.progress(3, 'Starting speed verification');
  for (const stage of VERIFY_STAGES) {
    const r = await probe.runCheck(stage.name, probeCtx, ctx.signal);
    const metrics = stage.name === 'DOWNLOAD_TEST' ? { measuredMbps: measured, planMbps: plan } : r.metrics;
    await prisma.probeResult.create({ data: { jobId: ctx.job.id, checkName: stage.name, passed: stage.name === 'DOWNLOAD_TEST' ? pass : r.passed, metrics } });
    await ctx.progress(stage.pct, stage.label);
  }
  await ctx.progress(95, 'Evaluating result');
  const ratio = measured / plan;
  const passed = ratio >= env.VERIFY_PASS_THRESHOLD;
  await finalizeVerification(ticketId, passed, measured, plan);
  await ctx.progress(100, passed ? 'Speed verified' : 'Speed below plan');
  return { passed, measuredMbps: measured, planMbps: plan, ratio: round(ratio) };
}

async function finalizeVerification(ticketId: string, passed: boolean, measured: number, plan: number) {
  let releasedTech: string | null = null;
  await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, ticketId);
    if (cur.status !== 'VERIFYING') throw abortError();
    if (passed) {
      await applyTransition(tx, ticketId, 'RESOLVED', { data: { resolvedAt: clock.now() }, message: `Speed verified: ${measured} Mbps of ${plan} Mbps plan. Waiting for customer confirmation.` });
      if (cur.technicianId) {
        await releaseCapacity(tx, cur.technicianId); // technician is free again
        await tx.ticketAssignment.updateMany({ where: { ticketId, role: 'PRIMARY', releasedAt: null }, data: { releasedAt: clock.now() } });
        releasedTech = cur.technicianId;
      }
    } else {
      await applyTransition(tx, ticketId, 'IN_PROGRESS', { message: `Verification FAILED: ${measured} Mbps of ${plan} Mbps plan. Technician must re-check.` });
      await createStepTx(tx, ticketId, { title: 'Re-check after failed verification', estimatedMinutes: 15 });
    }
    await refreshDerived(tx, ticketId, { jobProgress: 100 });
  });
  await publishTicket(ticketId, 'ticket.status_changed', { from: 'VERIFYING', to: passed ? 'RESOLVED' : 'IN_PROGRESS', verification: { passed, measuredMbps: measured, planMbps: plan } });
  if (!passed) await publishSteps(ticketId);
  if (releasedTech) await publishTechnician(releasedTech);
}

async function verifyFinalFailure(job: Job) {
  if (!job.ticketId) return;
  await prisma.$transaction(async (tx) => {
    const cur = await lockTicket(tx, job.ticketId as string);
    if (cur.status !== 'VERIFYING') return;
    await applyTransition(tx, job.ticketId as string, 'IN_PROGRESS', { message: 'Automatic verification could not run; supervisor attention needed' });
    await createStepTx(tx, job.ticketId as string, { title: 'Manual speed verification', estimatedMinutes: 10 });
    await addHistory(tx, { ticketId: job.ticketId as string, entity: 'SYSTEM', to: 'VERIFY_FAILED', message: 'Verification job failed after retries' });
  });
  await publishTicket(job.ticketId, 'ticket.status_changed', { to: 'IN_PROGRESS' });
  await publishSteps(job.ticketId);
  bus.publish('job.alert', [{ room: rooms.staff, payload: { ticketId: job.ticketId, message: 'Verification failed to run - manual check needed' } }]);
}

// ───────────────────────── EXPORT_REPORT (worker thread) ─────────────────────────

async function exportReport(ctx: JobContext) {
  const payload = (ctx.job.payload ?? {}) as { from?: string; to?: string };
  await ctx.progress(10, 'Reading tickets');
  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { ...(payload.from ? { gte: new Date(payload.from) } : {}), ...(payload.to ? { lte: new Date(payload.to) } : {}) } },
    include: { customer: true, categoryRef: { select: { name: true } }, technician: { include: { user: { select: { name: true } } } }, steps: { select: { status: true, estimatedMinutes: true, actualMinutes: true } } },
    orderBy: { number: 'asc' },
  });
  const rows = tickets.map((t) => ({
    ticketNo: `TX-${t.number}`, status: t.status, priority: t.priority, category: t.categoryRef.name, slaState: t.slaState,
    customer: t.customer.name, phone: t.customer.phone, technician: t.technician?.user.name ?? '',
    createdAt: t.createdAt.toISOString(), resolvedAt: t.resolvedAt?.toISOString() ?? '', slaDeadline: t.slaDeadline.toISOString(),
    estimatedMin: t.steps.filter((s) => s.status !== 'SKIPPED').reduce((a, s) => a + s.estimatedMinutes, 0),
    actualMin: t.steps.reduce((a, s) => a + (s.actualMinutes ?? 0), 0), reopenCount: t.reopenCount,
  }));
  await ctx.progress(40, 'Aggregating in worker thread');
  const out = await runInWorker({ rows, scale: clock.scale }, ctx.signal);
  await ctx.progress(95, 'Finishing');
  return { filename: `ticko-report-${new Date().toISOString().slice(0, 10)}.csv`, rowCount: rows.length, summary: out.summary, csv: out.csv };
}

/** CPU-bound work runs on a real OS thread so HTTP + WebSocket traffic is never starved. */
function runInWorker(data: unknown, signal: AbortSignal): Promise<{ csv: string; summary: Record<string, number> }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'workers', 'reportWorker.js'), { workerData: data });
    const onAbort = () => { void worker.terminate(); reject(abortError()); };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (m) => { signal.removeEventListener('abort', onAbort); resolve(m); });
    worker.once('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
    worker.once('exit', (code) => { if (code !== 0 && !signal.aborted) reject(new Error(`Report worker exited with code ${code}`)); });
  });
}

export function registerHandlers(): void {
  jobQueue.register('DIAGNOSE_LINE', diagnoseLine, diagnoseFinalFailure);
  jobQueue.register('VERIFY_SPEED', verifySpeed, verifyFinalFailure);
  jobQueue.register('EXPORT_REPORT', exportReport);
  logger.debug('Job handlers registered');
}
