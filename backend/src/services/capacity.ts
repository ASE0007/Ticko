import type { Db } from '../repositories/prisma';
import { Errors } from '../utils/errors';

/**
 * Atomically reserve one active-ticket slot (BR-02). The WHERE clause is the guard:
 * under concurrency the database row lock makes the second caller re-evaluate it and fail.
 */
export async function reserveCapacity(tx: Db, technicianId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE technicians
       SET active_tickets = active_tickets + 1, updated_at = now()
     WHERE id = ${technicianId}::uuid
       AND availability <> 'OFF_DUTY'::"Availability"
       AND active_tickets < max_active
     RETURNING id`;
  if (rows.length > 0) return;
  const t = await tx.technician.findUnique({ where: { id: technicianId }, select: { availability: true } });
  if (!t) throw Errors.notFound('Technician');
  if (t.availability === 'OFF_DUTY') throw Errors.technicianUnavailable();
  throw Errors.atCapacity();
}

export async function releaseCapacity(tx: Db, technicianId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE technicians SET active_tickets = GREATEST(active_tickets - 1, 0), updated_at = now()
     WHERE id = ${technicianId}::uuid`;
}
