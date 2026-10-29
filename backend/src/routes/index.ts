import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../repositories/prisma';
import { authenticate, requireRole, h, user, STAFF, MANAGERS, ALL_ROLES } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginLimiter, publicLimiter } from '../middleware/rateLimit';
import * as S from '../schemas';
import { Errors } from '../utils/errors';
import { clock } from '../utils/clock';
import { env } from '../config/env';
import * as auth from '../services/authService';
import * as tickets from '../services/ticketService';
import * as assign from '../services/assignmentService';
import * as steps from '../services/stepService';
import * as verify from '../services/verificationService';
import * as track from '../services/trackService';
import { getMetrics, reportSummary } from '../services/metricsService';
import * as categories from '../services/categoryService';
import * as customers from '../services/customerService';
import { technicianDay, teamDay, throughput } from '../services/technicianReports';
import { jobQueue } from '../queue/jobQueue';
import { toJobDTO } from '../services/views';
import { invalidatePolicyCache } from '../services/slaPolicy';
import { PRIORITY_RANK } from '../config/constants';

export const api = Router();
const pid = (req: { params: Record<string, unknown> }) => String(req.params['id']);

// ───────────── public ─────────────
api.post('/auth/login', loginLimiter, validate({ body: S.loginBody }), h(async (req, res) => {
  res.json(await auth.login(req.body.email, req.body.password));
}));

const pub = Router();
pub.use(publicLimiter);
pub.get('/track/:token', validate({ params: S.tokenParam }), h(async (req, res) => res.json(await track.getTracking(String(req.params['token'])))));
pub.post('/track/:token/confirm', validate({ params: S.tokenParam }), h(async (req, res) => res.json(await track.confirmByToken(String(req.params['token'])))));
pub.post('/track/:token/report-issue', validate({ params: S.tokenParam, body: S.trackReportBody }), h(async (req, res) => res.json(await track.reportIssueByToken(String(req.params['token']), req.body.note))));
api.use('/public', pub);

// ───────────── authenticated ─────────────
api.use(authenticate);

api.post('/auth/change-password', validate({ body: S.changePasswordBody }), h(async (req, res) => res.json(await auth.changePassword(user(req).id, req.body.currentPassword, req.body.newPassword))));
api.get('/auth/me', h(async (req, res) => res.json({ user: await auth.me(user(req).id) })));
api.get('/config', (_req, res) => res.json({ timeScale: clock.scale, demoMode: env.DEMO_MODE, maxActiveTickets: env.MAX_ACTIVE_TICKETS, verifyPassThreshold: env.VERIFY_PASS_THRESHOLD, autoCloseHours: env.AUTO_CLOSE_HOURS }));

// tickets
api.post('/tickets', requireRole(...STAFF), validate({ body: S.createTicketBody }), h(async (req, res) => res.status(201).json({ ticket: await tickets.createTicket(req.body, user(req)) })));
api.get('/tickets', requireRole(...ALL_ROLES), validate({ query: S.listTicketsQuery }), h(async (req, res) => res.json(await tickets.listTickets(req.query, user(req)))));
api.get('/customers', requireRole(...STAFF), h(async (req, res) => res.json({ items: await customers.listCustomers(typeof req.query['q'] === 'string' ? req.query['q'] : undefined, Number(req.query['limit']) || 20) })));
api.post('/customers', requireRole(...STAFF), validate({ body: S.newCustomer }), h(async (req, res) => res.status(201).json({ customer: await customers.createCustomer(req.body) })));
api.patch('/customers/:id', requireRole(...STAFF), validate({ params: S.idParam, body: S.patchCustomerBody }), h(async (req, res) => res.json({ customer: await customers.updateCustomer(pid(req), req.body) })));
api.get('/tickets/:id', requireRole(...ALL_ROLES), validate({ params: S.idParam }), h(async (req, res) => res.json(await tickets.getTicketDetail(pid(req), user(req)))));
api.patch('/tickets/:id', requireRole(...STAFF), validate({ params: S.idParam, body: S.updateTicketBody }), h(async (req, res) => res.json({ ticket: await tickets.updateTicket(pid(req), req.body, user(req)) })));
api.get('/tickets/:id/timeline', requireRole(...ALL_ROLES), validate({ params: S.idParam }), h(async (req, res) => res.json({ items: await tickets.getTimeline(pid(req), user(req)) })));
api.get('/tickets/:id/suggestions', requireRole(...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => res.json({ items: await assign.suggestTechnicians(pid(req)) })));
api.post('/tickets/:id/assign', requireRole(...MANAGERS), validate({ params: S.idParam, body: S.assignBody }), h(async (req, res) => {
  await assign.assignTicket(pid(req), req.body, user(req));
  res.json({ ok: true });
}));
api.post('/tickets/:id/helpers', requireRole(...MANAGERS), validate({ params: S.idParam, body: S.helperBody }), h(async (req, res) => {
  await assign.addHelper(pid(req), req.body.technicianId, user(req));
  res.status(201).json({ ok: true });
}));
api.post('/tickets/:id/request-verification', requireRole('TECHNICIAN', ...MANAGERS), validate({ params: S.idParam, body: S.verifyBody }), h(async (req, res) => res.status(202).json(await verify.requestVerification(pid(req), req.body.simulate, user(req)))));
api.post('/tickets/:id/confirm', requireRole(...STAFF), validate({ params: S.idParam, body: S.confirmBody }), h(async (req, res) => res.json({ ticket: await tickets.closeTicket(pid(req), user(req), 'operator', req.body.note) })));
api.post('/tickets/:id/reopen', requireRole(...STAFF), validate({ params: S.idParam, body: S.reopenBody }), h(async (req, res) => res.json({ ticket: await tickets.reopenTicket(pid(req), req.body.reason, user(req)) })));
api.post('/tickets/:id/cancel', requireRole(...STAFF), validate({ params: S.idParam, body: S.cancelBody }), h(async (req, res) => res.json({ ticket: await tickets.cancelTicket(pid(req), req.body.reason, user(req)) })));

// steps
api.get('/tickets/:id/steps', requireRole(...ALL_ROLES), validate({ params: S.idParam }), h(async (req, res) => {
  await tickets.assertCanView(user(req), pid(req));
  res.json(await steps.listSteps(pid(req)));
}));
api.post('/tickets/:id/steps', requireRole(...MANAGERS), validate({ params: S.idParam, body: S.createStepBody }), h(async (req, res) => res.status(201).json({ step: await steps.addStep(pid(req), req.body, user(req)) })));
api.patch('/steps/:id', requireRole(...MANAGERS), validate({ params: S.idParam, body: S.patchStepBody }), h(async (req, res) => res.json({ step: await steps.patchStep(pid(req), req.body, user(req)) })));
api.post('/steps/:id/start', requireRole('TECHNICIAN', ...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => res.json({ step: await steps.startStep(pid(req), user(req)) })));
api.post('/steps/:id/complete', requireRole('TECHNICIAN', ...MANAGERS), validate({ params: S.idParam, body: S.completeStepBody }), h(async (req, res) => res.json({ step: await steps.completeStep(pid(req), req.body.note, user(req)) })));
api.post('/steps/:id/skip', requireRole(...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => res.json({ step: await steps.skipStep(pid(req), user(req)) })));

// technicians
api.get('/technicians', requireRole(...ALL_ROLES), h(async (_req, res) => res.json({ items: await assign.listTechnicians() })));
api.patch('/technicians/:id/availability', requireRole('TECHNICIAN', ...MANAGERS), validate({ params: S.idParam, body: S.availabilityBody }), h(async (req, res) => res.json({ technician: await assign.setAvailability(pid(req), req.body.availability, user(req)) })));

// jobs
api.get('/jobs', requireRole(...MANAGERS), validate({ query: S.jobsQuery }), h(async (req, res) => {
  const q = req.query as unknown as { status?: string[]; limit: number };
  const rows = await prisma.job.findMany({ where: q.status ? { status: { in: q.status as never[] } } : {}, orderBy: { createdAt: 'desc' }, take: q.limit, include: { ticket: { select: { number: true, title: true } } } });
  res.json({ items: rows.map((j) => ({ ...toJobDTO(j), ticketNo: j.ticket ? `TX-${j.ticket.number}` : null, ticketTitle: j.ticket?.title ?? null })), stats: jobQueue.stats() });
}));
api.post('/jobs/:id/cancel', requireRole(...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => res.json({ cancelled: await jobQueue.cancelJob(pid(req)) })));
api.post('/jobs/:id/retry', requireRole(...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => {
  const j = await prisma.job.findUnique({ where: { id: pid(req) } });
  if (!j) throw Errors.notFound('Job');
  if (j.status !== 'FAILED' && j.status !== 'CANCELLED') throw Errors.unprocessable('JOB_NOT_RETRYABLE', `A ${j.status} job cannot be retried`);
  res.json({ job: toJobDTO(await jobQueue.retryJob(j.id)) });
}));

// metrics & reports
api.get('/metrics', requireRole(...ALL_ROLES), h(async (_req, res) => res.json(await getMetrics())));
api.get('/reports/summary', requireRole(...MANAGERS), validate({ query: S.reportExportBody }), h(async (req, res) => res.json(await reportSummary(req.query as never))));
api.post('/reports/export', requireRole(...MANAGERS), validate({ body: S.reportExportBody }), h(async (req, res) => {
  const job = await prisma.job.create({ data: { type: 'EXPORT_REPORT', priorityRank: PRIORITY_RANK.LOW, requestedById: user(req).id, payload: { from: req.body.from?.toISOString(), to: req.body.to?.toISOString() } } });
  jobQueue.enqueue(job);
  res.status(202).json({ jobId: job.id });
}));
api.get('/reports/export/:id', requireRole(...MANAGERS), validate({ params: S.idParam }), h(async (req, res) => {
  const j = await prisma.job.findUnique({ where: { id: pid(req) } });
  if (!j || j.type !== 'EXPORT_REPORT') throw Errors.notFound('Report');
  if (j.status !== 'SUCCEEDED') return void res.status(202).json({ status: j.status, progress: j.progress, stage: j.stage });
  const r = j.result as { filename: string; csv: string };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
  res.send(r.csv);
}));

// admin
api.get('/sla-policies', requireRole(...STAFF), h(async (_req, res) => res.json({ items: await prisma.slaPolicy.findMany({ orderBy: { resolutionMinutes: 'asc' } }) })));
api.put('/sla-policies', requireRole('ADMIN'), validate({ body: S.slaPoliciesBody }), h(async (req, res) => {
  await prisma.$transaction((req.body.policies as z.infer<typeof S.slaPoliciesBody>['policies']).map((p) => prisma.slaPolicy.upsert({ where: { priority: p.priority }, update: p, create: p })));
  invalidatePolicyCache();
  res.json({ items: await prisma.slaPolicy.findMany({ orderBy: { resolutionMinutes: 'asc' } }) });
}));
api.get('/users', requireRole('ADMIN'), h(async (_req, res) => res.json({ items: await auth.listUsers() })));

// categories (data, not an enum: managers can add new ones)
api.get('/categories', requireRole(...ALL_ROLES), h(async (req, res) => res.json({ items: await categories.listCategories(req.query['all'] === 'true' && user(req).role !== 'TECHNICIAN') })));
api.post('/categories', requireRole(...MANAGERS), validate({ body: S.createCategoryBody }), h(async (req, res) => res.status(201).json({ category: await categories.createCategory(req.body) })));
api.patch('/categories/:code', requireRole(...MANAGERS), validate({ params: S.codeParam, body: S.patchCategoryBody }), h(async (req, res) => res.json({ category: await categories.updateCategory(String(req.params['code']), req.body) })));
api.delete('/categories/:code', requireRole('ADMIN'), validate({ params: S.codeParam }), h(async (req, res) => { await categories.deleteCategory(String(req.params['code'])); res.status(204).end(); }));

// reports: technician day reports + dashboard throughput
api.get('/reports/throughput', requireRole(...STAFF), validate({ query: S.throughputQuery }), h(async (req, res) => res.json(await throughput((req.query as unknown as { hours: number }).hours))));
api.get('/reports/technicians/day', requireRole(...MANAGERS), validate({ query: S.dayRangeQuery }), h(async (req, res) => { const q = req.query as unknown as { from: Date; to: Date }; res.json(await teamDay(q.from, q.to)); }));
api.get('/reports/technicians/:id/day', requireRole(...ALL_ROLES), validate({ params: S.idParam, query: S.dayRangeQuery }), h(async (req, res) => {
  const u = user(req);
  if (u.role === 'TECHNICIAN' && u.technicianId !== pid(req)) throw Errors.forbidden('You can only view your own report');
  if (u.role === 'OPERATOR') throw Errors.forbidden();
  const q = req.query as unknown as { from: Date; to: Date };
  res.json(await technicianDay(pid(req), q.from, q.to));
}));
api.post('/users', requireRole('ADMIN'), validate({ body: S.createUserBody }), h(async (req, res) => res.status(201).json({ user: await auth.createUser(req.body) })));
api.patch('/users/:id', requireRole('ADMIN'), validate({ params: S.idParam, body: S.patchUserBody }), h(async (req, res) => res.json({ user: await auth.patchUser(pid(req), req.body, user(req)) })));
