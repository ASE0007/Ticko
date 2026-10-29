import type { Diagnosis } from '@prisma/client';

export interface ProbeContext {
  ticketId: string;
  /** category code (built-in or admin-created) */
  category: string;
  /** work-plan template the admin chose for this category (used by custom categories) */
  planTemplate?: Diagnosis;
  planMbps: number;
}

export interface ProbeStageResult {
  stage: string;
  passed: boolean;
  metrics: Record<string, number | string | boolean>;
}

/**
 * Port for remote line checks. Today: SimulatedProbe.
 * Tomorrow: a TR-069 / SNMP / vendor-API adapter, with ZERO change to business logic.
 */
export interface NetworkProbe {
  runCheck(stage: string, ctx: ProbeContext, signal: AbortSignal): Promise<ProbeStageResult>;
}
