import type { Role } from '@prisma/client';
import { prisma } from '../repositories/prisma';

export interface Session { active: boolean; tokenVersion: number; role: Role; name: string; technicianId: string | null }

const TTL_MS = 5000;
const cache = new Map<string, { at: number; s: Session | null }>();

/**
 * Current server-side truth about a user (active flag, role, token version).
 * Cached for a few seconds so authentication stays cheap, and invalidated immediately when an
 * admin edits the account. This is what makes "disable user" / "reset password" take effect NOW
 * instead of when the JWT expires.
 */
export async function getSession(userId: string): Promise<Session | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.s;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, tokenVersion: true, role: true, name: true, technician: { select: { id: true } } } });
  const s: Session | null = u ? { active: u.active, tokenVersion: u.tokenVersion, role: u.role, name: u.name, technicianId: u.technician?.id ?? null } : null;
  cache.set(userId, { at: Date.now(), s });
  return s;
}

export function invalidateSession(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
