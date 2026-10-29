import type { Job, JobType } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { JOB_RETRY_DELAYS_MS } from '../config/constants';
import { logger } from '../utils/logger';
import { isAbortError } from '../utils/sleep';
import { bus, rooms } from '../realtime/eventBus';
import { refreshDerived } from '../services/ticketCore';
import { toJobDTO } from '../services/views';
import { PriorityQueue } from './priorityQueue';

/** One priority level is worth this much waiting time -> anti-starvation "aging". */
export const AGING_MS = 5 * 60_000;

export interface JobContext {
  job: Job;
  signal: AbortSignal;
  /** Persist + broadcast progress. Also a cancellation checkpoint. */
  progress(pct: number, stage: string): Promise<void>;
}
export type JobHandler = (ctx: JobContext) => Promise<unknown>;
export type FinalFailureHook = (job: Job, err: unknown) => Promise<void>;

interface RunningEntry {
  controller: AbortController;
  done: Promise<void>;
}

export class JobQueue {
  private heap = new PriorityQueue();
  private handlers = new Map<JobType, { run: JobHandler; onFinalFailure?: FinalFailureHook }>();
  private running = new Map<string, RunningEntry>();
  private timers = new Set<NodeJS.Timeout>();
  private started = false;
  private stopping = false;
  private counters = { succeeded: 0, failed: 0, cancelled: 0, retried: 0 };
  private finishedAt: number[] = [];

  constructor(public concurrency: number = env.WORKER_CONCURRENCY) {}

  register(type: JobType, run: JobHandler, onFinalFailure?: FinalFailureHook): void {
    this.handlers.set(type, onFinalFailure ? { run, onFinalFailure } : { run });
  }

  /** Called AFTER the job row was committed. Returns immediately: never blocks the caller. */
  enqueue(job: Pick<Job, 'id' | 'priorityRank' | 'createdAt' | 'type' | 'ticketId'>): void {
    this.heap.push({ id: job.id, score: job.createdAt.getTime() + job.priorityRank * AGING_MS });
    bus.publish('job.queued', [{ room: rooms.staff, payload: { job: { id: job.id, type: job.type, ticketId: job.ticketId, status: 'QUEUED', priorityRank: job.priorityRank } } }]);
    this.dispatch();
  }

  start(): void {
    this.started = true;
    this.stopping = false;
    this.dispatch();
  }

  /** Crash recovery (FR-35): anything unfinished in the DB goes back into the queue. */
  async recover(): Promise<number> {
    await prisma.job.updateMany({ where: { status: 'RUNNING' }, data: { status: 'QUEUED' } });
    const queued = await prisma.job.findMany({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    for (const j of queued) this.heap.push({ id: j.id, score: j.createdAt.getTime() + j.priorityRank * AGING_MS });
    if (queued.length) logger.info({ count: queued.length }, 'Recovered unfinished jobs');
    return queued.length;
  }

  private dispatch(): void {
    while (this.started && !this.stopping && this.running.size < this.concurrency) {
      const next = this.heap.pop();
      if (!next) break;
      this.launch(next.id);
    }
  }

  private launch(jobId: string): void {
    const controller = new AbortController();
    const entry: RunningEntry = { controller, done: Promise.resolve() };
    this.running.set(jobId, entry); // reserve the worker slot synchronously
    entry.done = this.execute(jobId, controller)
      .catch((err) => logger.error({ err, jobId }, 'Job runner crashed'))
      .finally(() => {
        this.running.delete(jobId);
        this.dispatch();
      });
  }

  private async execute(jobId: string, controller: AbortController): Promise<void> {
    const claimed = await prisma.job.updateMany({
      where: { id: jobId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, progress: 0, stage: null, error: null },
    });
    if (claimed.count === 0) return; // cancelled while waiting in the queue
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const handler = this.handlers.get(job.type);
    this.emitJob('job.started', job);
    const log = logger.child({ jobId, type: job.type, ticketId: job.ticketId });

    const ctx: JobContext = {
      job,
      signal: controller.signal,
      progress: async (pct, stage) => {
        if (controller.signal.aborted) throw abortFrom(controller.signal);
        const progress = Math.max(0, Math.min(100, Math.round(pct)));
        await prisma.job.update({ where: { id: jobId }, data: { progress, stage } });
        let ticketProgress: number | undefined;
        if (job.ticketId) {
          await refreshDerived(prisma, job.ticketId, { jobProgress: progress });
          const t = await prisma.ticket.findUnique({ where: { id: job.ticketId }, select: { progress: true } });
          ticketProgress = t?.progress;
        }
        const payload = { jobId, ticketId: job.ticketId, type: job.type, progress, stage, ticketProgress };
        bus.publish('job.progress', [
          { room: rooms.staff, payload },
          ...(job.ticketId ? [{ room: rooms.ticket(job.ticketId), payload }, { room: rooms.track(job.ticketId), payload: { ticketId: job.ticketId, progress: ticketProgress, stage } }] : []),
        ]);
      },
    };

    try {
      if (!handler) throw new Error(`No handler registered for ${job.type}`);
      const result = await handler.run(ctx);
      if (controller.signal.aborted) throw abortFrom(controller.signal);
      const done = await prisma.job.update({
        where: { id: jobId },
        data: { status: 'SUCCEEDED', progress: 100, finishedAt: new Date(), result: (result ?? null) as never },
      });
      this.counters.succeeded++;
      this.markFinished();
      this.emitJob('job.completed', done);
      log.info('Job succeeded');
    } catch (err) {
      await this.handleFailure(job, err, controller, handler?.onFinalFailure, log);
    }
  }

  private async handleFailure(
    job: Job, err: unknown, controller: AbortController, hook: FinalFailureHook | undefined, log: typeof logger,
  ): Promise<void> {
    const signal = controller.signal;
    if (signal.aborted && signal.reason === 'shutdown') {
      // Server is stopping: put the job back untouched so recovery re-runs it.
      await prisma.job.update({ where: { id: job.id }, data: { status: 'QUEUED', attempts: { decrement: 1 } } });
      return;
    }
    if (signal.aborted || isAbortError(err)) {
      const j = await prisma.job.update({ where: { id: job.id }, data: { status: 'CANCELLED', finishedAt: new Date(), stage: 'cancelled' } });
      this.counters.cancelled++;
      this.markFinished();
      this.emitJob('job.cancelled', j);
      log.info('Job cancelled');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts; // already incremented when claimed
    if (attempts < job.maxAttempts) {
      const delay = JOB_RETRY_DELAYS_MS[Math.min(attempts - 1, JOB_RETRY_DELAYS_MS.length - 1)] as number;
      const j = await prisma.job.update({ where: { id: job.id }, data: { status: 'QUEUED', error: message, stage: `retry in ${delay / 1000}s` } });
      this.counters.retried++;
      this.emitJob('job.retrying', j);
      log.warn({ err, attempts, delay }, 'Job failed, will retry');
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.stopping) return;
        this.heap.push({ id: job.id, score: Date.now() });
        this.dispatch();
      }, delay);
      timer.unref();
      this.timers.add(timer);
      return;
    }
    const j = await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: message, finishedAt: new Date() } });
    this.counters.failed++;
    this.markFinished();
    this.emitJob('job.failed', j);
    log.error({ err }, 'Job failed permanently');
    try {
      await hook?.(j, err);
    } catch (hookErr) {
      log.error({ err: hookErr }, 'Final-failure hook failed');
    }
  }

  /** Cooperative cancellation (FR-33). Queued jobs are dropped, running jobs get aborted. */
  async cancelJob(jobId: string): Promise<boolean> {
    const entry = this.running.get(jobId);
    if (entry) {
      entry.controller.abort('cancelled');
      return true;
    }
    this.heap.remove(jobId);
    const res = await prisma.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'CANCELLED', finishedAt: new Date(), stage: 'cancelled' } });
    if (res.count) {
      const j = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      this.counters.cancelled++;
      this.emitJob('job.cancelled', j);
    }
    return res.count > 0;
  }

  async cancelForTicket(ticketId: string): Promise<number> {
    const active = await prisma.job.findMany({ where: { ticketId, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
    let n = 0;
    for (const j of active) if (await this.cancelJob(j.id)) n++;
    return n;
  }

  /** Put a failed/cancelled job back in the queue (supervisor "retry"). */
  async retryJob(jobId: string): Promise<Job> {
    const j = await prisma.job.update({ where: { id: jobId }, data: { status: 'QUEUED', error: null, attempts: 0, progress: 0, stage: null, finishedAt: null } });
    this.enqueue(j);
    return j;
  }

  stats() {
    const cutoff = Date.now() - 60_000;
    this.finishedAt = this.finishedAt.filter((t) => t >= cutoff);
    return {
      queued: this.heap.size,
      running: this.running.size,
      concurrency: this.concurrency,
      utilisation: Math.round((this.running.size / this.concurrency) * 100),
      jobsPerMin: this.finishedAt.length,
      ...this.counters,
    };
  }

  /** Graceful shutdown: running jobs are returned to QUEUED for recovery on next boot. */
  async shutdown(timeoutMs = 5000): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const e of this.running.values()) e.controller.abort('shutdown');
    await Promise.race([
      Promise.allSettled([...this.running.values()].map((e) => e.done)),
      new Promise((r) => setTimeout(r, timeoutMs).unref()),
    ]);
  }

  /** Test helper: wait until nothing is queued or running. */
  async idle(timeoutMs = 10_000): Promise<void> {
    const t0 = Date.now();
    while (this.heap.size > 0 || this.running.size > 0) {
      if (Date.now() - t0 > timeoutMs) throw new Error('JobQueue.idle timeout');
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  private markFinished(): void {
    this.finishedAt.push(Date.now());
  }

  private emitJob(type: string, job: Job): void {
    const payload = { job: toJobDTO(job) };
    bus.publish(type, [
      { room: rooms.staff, payload },
      ...(job.ticketId ? [{ room: rooms.ticket(job.ticketId), payload }] : []),
    ]);
  }
}

function abortFrom(signal: AbortSignal): Error {
  const e = new Error(String(signal.reason ?? 'aborted'));
  e.name = 'AbortError';
  return e;
}

export const jobQueue = new JobQueue();
