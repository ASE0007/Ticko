import bcrypt from 'bcryptjs';
import { Prisma, type Role, type Skill } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { Errors } from '../utils/errors';
import { signToken, type AuthUser } from '../middleware/auth';
import { invalidateSession } from './sessionGuard';
import { publishTechnician } from './assignmentService';

// Compared when the e-mail is unknown so response time does not reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

const emailInUse = () => Errors.conflict('EMAIL_IN_USE', 'That e-mail is already used by another account.');

export async function login(email: string, password: string) {
  const u = await prisma.user.findUnique({ where: { email }, include: { technician: { select: { id: true } } } });
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok || !u.active) throw Errors.unauthorized('Invalid e-mail or password');
  const user: AuthUser = { id: u.id, name: u.name, role: u.role, technicianId: u.technician?.id ?? null, tv: u.tokenVersion };
  return { token: signToken(user), user: { id: u.id, name: u.name, email: u.email, role: u.role, technicianId: user.technicianId } };
}

export async function me(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, include: { technician: { select: { id: true } } } });
  if (!u || !u.active) throw Errors.unauthorized();
  return { id: u.id, name: u.name, email: u.email, role: u.role, technicianId: u.technician?.id ?? null };
}

/** Any signed-in user changes their own password; returns a fresh token so this session stays signed in. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { technician: { select: { id: true } } } });
  if (!u) throw Errors.unauthorized();
  if (!(await bcrypt.compare(currentPassword, u.passwordHash))) throw Errors.badRequest('Current password is wrong', [{ path: 'currentPassword', message: 'Current password is wrong' }]);
  if (currentPassword === newPassword) throw Errors.badRequest('Choose a different password', [{ path: 'newPassword', message: 'New password must differ from the current one' }]);
  const upd = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, env.BCRYPT_COST), tokenVersion: { increment: 1 } } });
  invalidateSession(userId);
  const user: AuthUser = { id: u.id, name: u.name, role: u.role, technicianId: u.technician?.id ?? null, tv: upd.tokenVersion };
  return { token: signToken(user), user: { id: u.id, name: u.name, email: u.email, role: u.role, technicianId: user.technicianId } };
}

// ───────────────────────── admin: user management ─────────────────────────

const userInclude = { technician: { select: { id: true, skills: true, maxActive: true, activeTickets: true, availability: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const toUserDTO = (u: UserRow) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, createdAt: u.createdAt,
  technicianId: u.technician?.id ?? null, skills: u.technician?.skills ?? [], maxActive: u.technician?.maxActive ?? null,
  activeTickets: u.technician?.activeTickets ?? null, availability: u.technician?.availability ?? null,
});

export async function listUsers() {
  const rows = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }], include: userInclude });
  return rows.map(toUserDTO);
}

export async function createUser(b: { name: string; email: string; password: string; role: Role; skills: Skill[]; maxActive?: number | undefined }) {
  if (await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } })) throw emailInUse();
  const u = await prisma.user.create({
    data: {
      name: b.name, email: b.email, role: b.role, passwordHash: await bcrypt.hash(b.password, env.BCRYPT_COST),
      ...(b.role === 'TECHNICIAN' ? { technician: { create: { skills: b.skills, maxActive: b.maxActive ?? env.MAX_ACTIVE_TICKETS } } } : {}),
    },
    include: userInclude,
  });
  if (u.technician) await publishTechnician(u.technician.id); // dashboards show the new technician instantly
  return toUserDTO(u);
}

export async function patchUser(
  id: string,
  b: { name?: string | undefined; email?: string | undefined; password?: string | undefined; role?: Role | undefined; active?: boolean | undefined; skills?: Skill[] | undefined; maxActive?: number | undefined },
  actor: AuthUser,
) {
  const cur = await prisma.user.findUnique({ where: { id }, include: userInclude });
  if (!cur) throw Errors.notFound('User');

  const roleChange = b.role !== undefined && b.role !== cur.role;
  if (roleChange && (b.role === 'TECHNICIAN' || cur.role === 'TECHNICIAN')) {
    throw Errors.unprocessable('ROLE_CHANGE_UNSUPPORTED', 'Technician accounts cannot be converted. Create a new account with the role you need.');
  }
  const losesAdmin = cur.role === 'ADMIN' && cur.active && ((roleChange && b.role !== 'ADMIN') || b.active === false);
  if (losesAdmin) {
    if (id === actor.id) throw Errors.conflict('SELF_LOCKOUT', 'You cannot remove your own admin access or deactivate your own account.');
    if ((await prisma.user.count({ where: { role: 'ADMIN', active: true } })) <= 1) throw Errors.conflict('LAST_ADMIN', 'At least one active admin is required.');
  }
  if (b.active === false && cur.technician && cur.technician.activeTickets > 0) {
    throw Errors.conflict('TECHNICIAN_HAS_ACTIVE_TICKETS', `${cur.name} still has ${cur.technician.activeTickets} active ticket(s). Reassign them first.`);
  }
  if (b.maxActive !== undefined && cur.technician && b.maxActive < cur.technician.activeTickets) {
    throw Errors.conflict('CAPACITY_BELOW_LOAD', `Capacity cannot be lower than the current load (${cur.technician.activeTickets}).`);
  }
  if (b.email && b.email !== cur.email && (await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } }))) throw emailInUse();

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.role !== undefined ? { role: b.role } : {}),
        ...(b.active !== undefined ? { active: b.active } : {}),
        ...(b.password !== undefined ? { passwordHash: await bcrypt.hash(b.password, env.BCRYPT_COST), tokenVersion: { increment: 1 } } : {}),
      },
    }).catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw emailInUse(); throw e; });
    if (cur.technician) {
      await tx.technician.update({
        where: { id: cur.technician.id },
        data: {
          ...(b.skills !== undefined ? { skills: b.skills } : {}),
          ...(b.maxActive !== undefined ? { maxActive: b.maxActive } : {}),
          ...(b.active === false ? { availability: 'OFF_DUTY' as const } : {}),
        },
      });
    }
    return u;
  });
  invalidateSession(id); // takes effect on the very next request / socket auth
  if (cur.technician) await publishTechnician(cur.technician.id);
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: updated.id }, include: userInclude });
  return toUserDTO(fresh);
}
