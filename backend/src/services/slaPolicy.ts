import type { Priority } from '@prisma/client';
import { prisma } from '../repositories/prisma';

interface Policy { resolutionMinutes: number; warningPct: number }
let cache: { at: number; map: Map<Priority, Policy> } | null = null;
const TTL_MS = 10_000;

export async function getPolicy(priority: Priority): Promise<Policy> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const rows = await prisma.slaPolicy.findMany();
    cache = { at: Date.now(), map: new Map(rows.map((r) => [r.priority, { resolutionMinutes: r.resolutionMinutes, warningPct: r.warningPct }])) };
  }
  return cache.map.get(priority) ?? { resolutionMinutes: 1440, warningPct: 75 };
}

export function invalidatePolicyCache(): void {
  cache = null;
}
