import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { bearer, createDiagnosedTicket, loginMany, newTicketBody, resetDb, startServer, waitFor, PASSWORD, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let admin: string, sup: string, op: string, rafi: string;
const api = () => request(srv.app);

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [admin, sup, op, rafi] = await loginMany(srv.app, ['admin@t.test', 'sup@t.test', 'op1@t.test', 'rafi@t.test'] as const);
});

const newTech = { name: 'Tech Karim', email: 'karim.tech@t.test', password: 'Secret123', role: 'TECHNICIAN', skills: ['FIBER', 'NETWORK'], maxActive: 3 };

describe('admin manages accounts (every technician has an individual login)', () => {
  it('admin creates a technician who can immediately log in; others cannot create users', async () => {
    expect((await api().post('/api/users').set(bearer(sup)).send(newTech)).status).toBe(403);
    const res = await api().post('/api/users').set(bearer(admin)).send(newTech);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'TECHNICIAN', maxActive: 3, skills: ['FIBER', 'NETWORK'] });
    expect(res.body.user.technicianId).toBeTruthy();
    const l = await api().post('/api/auth/login').send({ email: 'karim.tech@t.test', password: 'Secret123' });
    expect(l.status).toBe(200);
    expect(l.body.user.technicianId).toBe(res.body.user.technicianId);
    const techs = await api().get('/api/technicians').set(bearer(sup));
    expect(techs.body.items.some((t: any) => t.name === 'Tech Karim' && t.maxActive === 3)).toBe(true);
  });

  it('rejects duplicate e-mails and weak passwords with field errors', async () => {
    expect((await api().post('/api/users').set(bearer(admin)).send({ ...newTech, email: 'RAFI@t.test' })).body.error.code).toBe('EMAIL_IN_USE');
    const weak = await api().post('/api/users').set(bearer(admin)).send({ ...newTech, password: 'abcdefgh' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.some((d: any) => d.path === 'password')).toBe(true);
  });

  it('changing e-mail/password takes effect at once: the old password and the OLD TOKEN stop working', async () => {
    const tid = seed.techUsers[0]!.id;
    expect((await api().get('/api/tickets').set(bearer(rafi))).status).toBe(200);
    const res = await api().patch(`/api/users/${tid}`).set(bearer(admin)).send({ email: 'rafi.new@t.test', password: 'Brand1New99' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('rafi.new@t.test');
    expect((await api().get('/api/tickets').set(bearer(rafi))).status).toBe(401); // session killed immediately
    expect((await api().post('/api/auth/login').send({ email: 'rafi@t.test', password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: 'rafi.new@t.test', password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: 'rafi.new@t.test', password: 'Brand1New99' })).status).toBe(200);
  });

  it('a disabled account is locked out immediately, including WebSocket logins', async () => {
    const op2 = seed.operator2.id;
    const tok = (await api().post('/api/auth/login').send({ email: 'op2@t.test', password: PASSWORD })).body.token;
    expect((await api().get('/api/tickets').set(bearer(tok))).status).toBe(200);
    await api().patch(`/api/users/${op2}`).set(bearer(admin)).send({ active: false }).expect(200);
    expect((await api().get('/api/tickets').set(bearer(tok))).status).toBe(401);
    const code = await new Promise<number>((resolve) => { const ws = new WebSocket(srv.wsUrl); ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: tok }))); ws.on('close', (c) => resolve(c)); });
    expect(code).toBe(4401);
  });

  it('protects the system: no self-lockout, no last-admin removal, no deactivating a technician with active tickets', async () => {
    expect((await api().patch(`/api/users/${seed.admin.id}`).set(bearer(admin)).send({ active: false })).body.error.code).toBe('SELF_LOCKOUT');
    const second = (await api().post('/api/users').set(bearer(admin)).send({ name: 'Admin Two', email: 'a2@t.test', password: 'Secret123', role: 'ADMIN' })).body.user;
    const a2 = (await api().post('/api/auth/login').send({ email: 'a2@t.test', password: 'Secret123' })).body.token;
    expect((await api().patch(`/api/users/${seed.admin.id}`).set(bearer(a2)).send({ role: 'SUPERVISOR' })).status).toBe(200); // fine: another admin remains
    expect((await api().patch(`/api/users/${second.id}`).set(bearer(a2)).send({ active: false })).body.error.code).toBe('SELF_LOCKOUT');

    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const v = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version;
    await api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[0]!.id, version: v }).expect(200);
    const blocked = await api().patch(`/api/users/${seed.techUsers[0]!.id}`).set(bearer(a2)).send({ active: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('TECHNICIAN_HAS_ACTIVE_TICKETS');
    expect((await api().patch(`/api/users/${seed.techUsers[0]!.id}`).set(bearer(a2)).send({ role: 'OPERATOR' })).body.error.code).toBe('ROLE_CHANGE_UNSUPPORTED');
  });

  it('admin edits skills and capacity; capacity cannot drop below the current load', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const v = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version;
    await api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[1]!.id, version: v }).expect(200);
    const ok = await api().patch(`/api/users/${seed.techUsers[1]!.id}`).set(bearer(admin)).send({ skills: ['WIFI'], maxActive: 4 });
    expect(ok.body.user).toMatchObject({ skills: ['WIFI'], maxActive: 4 });
    expect((await api().patch(`/api/users/${seed.techUsers[1]!.id}`).set(bearer(admin)).send({ maxActive: 1, ...{} })).status).toBe(200); // load is 1
    await prisma.technician.update({ where: { id: seed.techs[1]!.id }, data: { maxActive: 2 } });
    const id2 = await createDiagnosedTicket(srv.app, op, seed.customer.id, { title: 'Second ticket here' });
    const v2 = (await api().get(`/api/tickets/${id2}`).set(bearer(sup))).body.ticket.version;
    await api().post(`/api/tickets/${id2}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[1]!.id, version: v2 }).expect(200);
    expect((await api().patch(`/api/users/${seed.techUsers[1]!.id}`).set(bearer(admin)).send({ maxActive: 1 })).body.error.code).toBe('CAPACITY_BELOW_LOAD');
  });

  it('any user can change their own password (needs the current one) and stays signed in', async () => {
    const bad = await api().post('/api/auth/change-password').set(bearer(rafi)).send({ currentPassword: 'wrong', newPassword: 'Another123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('currentPassword');
    const ok = await api().post('/api/auth/change-password').set(bearer(rafi)).send({ currentPassword: PASSWORD, newPassword: 'Another123' });
    expect(ok.status).toBe(200);
    expect((await api().get('/api/tickets').set(bearer(rafi))).status).toBe(401); // old token dead
    expect((await api().get('/api/tickets').set(bearer(ok.body.token))).status).toBe(200); // new token works
    expect((await api().post('/api/auth/login').send({ email: 'rafi@t.test', password: 'Another123' })).status).toBe(200);
  });
});

describe('categories are data: managers can add new ones', () => {
  it('a new category appears for everyone and drives the diagnosis plan', async () => {
    expect((await api().post('/api/categories').set(bearer(op)).send({ name: 'Fiber cut' })).status).toBe(403);
    const created = await api().post('/api/categories').set(bearer(sup)).send({ name: 'Fiber cut', planTemplate: 'LINE_FAULT', description: 'Cable damaged by digging' });
    expect(created.status).toBe(201);
    expect(created.body.category.code).toBe('FIBER_CUT');
    expect((await api().get('/api/categories').set(bearer(op))).body.items.map((c: any) => c.code)).toContain('FIBER_CUT');
    expect((await api().post('/api/categories').set(bearer(sup)).send({ name: 'fiber CUT' })).body.error.code).toBe('CATEGORY_EXISTS');

    const t = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, category: 'FIBER_CUT' }));
    expect(t.status).toBe(201);
    expect(t.body.ticket.categoryName).toBe('Fiber cut');
    await jobQueue.idle();
    const d = await api().get(`/api/tickets/${t.body.ticket.id}`).set(bearer(sup));
    expect(d.body.ticket.diagnosis).toBe('LINE_FAULT'); // admin-chosen template used for the work plan
    expect(d.body.steps[0].title).toContain('fiber');
    expect((await api().get('/api/tickets?category=FIBER_CUT').set(bearer(sup))).body.total).toBe(1);
  });

  it('disabled or unknown categories are rejected on the form field; built-ins cannot be deleted', async () => {
    await api().post('/api/categories').set(bearer(sup)).send({ name: 'Temporary' }).expect(201);
    await api().patch('/api/categories/TEMPORARY').set(bearer(sup)).send({ active: false }).expect(200);
    const r = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, category: 'TEMPORARY' }));
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe('category');
    expect((await api().get('/api/categories').set(bearer(op))).body.items.some((c: any) => c.code === 'TEMPORARY')).toBe(false);
    expect((await api().get('/api/categories?all=true').set(bearer(sup))).body.items.some((c: any) => c.code === 'TEMPORARY')).toBe(true);
    expect((await api().delete('/api/categories/OTHER').set(bearer(admin))).body.error.code).toBe('CATEGORY_BUILTIN');
    expect((await api().delete('/api/categories/TEMPORARY').set(bearer(admin))).status).toBe(204);
  });
});
