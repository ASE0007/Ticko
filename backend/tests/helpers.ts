import http from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/repositories/prisma';
import { hub } from '../src/realtime/wsHub';
import { jobQueue } from '../src/queue/jobQueue';
import { registerHandlers } from '../src/queue/handlers';
import { scheduler } from '../src/services/slaScheduler';
import { invalidatePolicyCache } from '../src/services/slaPolicy';

export const PASSWORD = 'Passw0rd!';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE probe_results, jobs, status_history, step_dependencies, work_steps, ticket_assignments, tickets, customers, technicians, users, sla_policies, categories RESTART IDENTITY CASCADE',
  );
  await prisma.$executeRawUnsafe('ALTER SEQUENCE tickets_number_seq RESTART WITH 1001'); // same start as the migration
  invalidatePolicyCache();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const mk = (name: string, email: string, role: any) => prisma.user.create({ data: { name, email, role, passwordHash } });
  const [admin, supervisor, operator, operator2] = await Promise.all([
    mk('Admin A', 'admin@t.test', 'ADMIN'), mk('Super S', 'sup@t.test', 'SUPERVISOR'),
    mk('Op One', 'op1@t.test', 'OPERATOR'), mk('Op Two', 'op2@t.test', 'OPERATOR'),
  ]);
  const techUsers = await Promise.all([mk('Tech Rafi', 'rafi@t.test', 'TECHNICIAN'), mk('Tech Nusrat', 'nusrat@t.test', 'TECHNICIAN'), mk('Tech Imran', 'imran@t.test', 'TECHNICIAN')]);
  const techs = await Promise.all(techUsers.map((u, i) => prisma.technician.create({ data: { userId: u.id, skills: [['NETWORK', 'FIBER'], ['ROUTER', 'WIFI'], ['GENERAL']][i] as any, maxActive: 2 } })));
  const customer = await prisma.customer.create({ data: { accountNo: 'ACC-T1', name: 'Karim Uddin', phone: '+8801711000001', address: 'Mirpur DOHS', planMbps: 50 } });
  await prisma.category.createMany({ data: [
    { code: 'SLOW_SPEED', name: 'Slow speed', planTemplate: 'UNKNOWN', builtin: true, sortOrder: 1 }, { code: 'NO_CONNECTION', name: 'No connection', planTemplate: 'LINE_FAULT', builtin: true, sortOrder: 2 },
    { code: 'ROUTER_ISSUE', name: 'Router issue', planTemplate: 'ROUTER_CONFIG', builtin: true, sortOrder: 3 }, { code: 'NEW_CONNECTION', name: 'New connection', planTemplate: 'PROVISIONING', builtin: true, sortOrder: 4 },
    { code: 'BILLING_LINK', name: 'Billing link', planTemplate: 'PROVISIONING', builtin: true, sortOrder: 5 }, { code: 'OTHER', name: 'Other', planTemplate: 'UNKNOWN', builtin: true, sortOrder: 6 },
  ] });
  await prisma.slaPolicy.createMany({ data: [
    { priority: 'CRITICAL', resolutionMinutes: 240, warningPct: 75 }, { priority: 'HIGH', resolutionMinutes: 480, warningPct: 75 },
    { priority: 'MEDIUM', resolutionMinutes: 1440, warningPct: 75 }, { priority: 'LOW', resolutionMinutes: 2880, warningPct: 75 },
  ] });
  return { admin, supervisor, operator, operator2, techUsers, techs, customer };
}

export type Seed = Awaited<ReturnType<typeof resetDb>>;

export async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  hub.attach(server);
  registerHandlers();
  jobQueue.start();
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    app, server, port, httpUrl: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      scheduler.stop();
      await jobQueue.shutdown(2000);
      await hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function login(app: http.RequestListener | any, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body.token as string;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function waitFor<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, timeoutMs = 8000, label = 'condition'): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const newTicketBody = (over: Record<string, unknown> = {}) => ({
  customerId: undefined as string | undefined,
  title: 'Internet very slow', description: 'Speed is far below plan since morning', category: 'ROUTER_ISSUE', priority: 'HIGH', ...over,
});

/** Create a ticket as operator and wait until diagnostics finished (AWAITING_ASSIGNMENT). */
export async function createDiagnosedTicket(app: any, opToken: string, customerId: string, over: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/tickets').set(bearer(opToken)).send(newTicketBody({ customerId, ...over }));
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.ticket.id as string;
  await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))?.status === 'AWAITING_ASSIGNMENT', 8000, 'diagnosis');
  return id;
}

/** Log several users in parallel; keeps tuple length so destructuring stays type-safe. */
export async function loginMany<const T extends readonly string[]>(app: any, emails: T): Promise<{ [K in keyof T]: string }> {
  return (await Promise.all(emails.map((e) => login(app, e)))) as { [K in keyof T]: string };
}
