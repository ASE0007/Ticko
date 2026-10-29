import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { Errors } from '../utils/errors';
import { getSession } from '../services/sessionGuard';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  technicianId: string | null;
  /** token version the JWT was issued with (bumped on password reset) */
  tv: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ name: user.name, role: user.role, tid: user.technicianId, tv: user.tv }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthUser {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    return { id: String(p.sub), name: String(p['name']), role: p['role'] as Role, technicianId: (p['tid'] as string | null) ?? null, tv: Number(p['tv'] ?? 0) };
  } catch {
    throw Errors.unauthorized('Invalid or expired token');
  }
}

/** Verify the JWT AND that the account is still active with the same token version. */
export async function resolveUser(token: string): Promise<AuthUser> {
  const claims = verifyToken(token);
  const session = await getSession(claims.id);
  if (!session || !session.active || session.tokenVersion !== claims.tv) throw Errors.unauthorized('Session expired. Please sign in again.');
  // role / name / technician link always come from the database, never from a stale token
  return { ...claims, role: session.role, name: session.name, technicianId: session.technicianId };
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(Errors.unauthorized());
  resolveUser(h.slice(7)).then((u) => { req.user = u; next(); }, next);
};

/** RBAC: allow only the listed roles (FR-02). */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(Errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(Errors.forbidden());
    next();
  };

export const STAFF: Role[] = ['OPERATOR', 'SUPERVISOR', 'ADMIN'];
export const MANAGERS: Role[] = ['SUPERVISOR', 'ADMIN'];
export const ALL_ROLES: Role[] = ['OPERATOR', 'SUPERVISOR', 'TECHNICIAN', 'ADMIN'];

export function user(req: Request): AuthUser {
  if (!req.user) throw Errors.unauthorized();
  return req.user;
}

/** Wrap async handlers so rejections reach the central error handler. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
