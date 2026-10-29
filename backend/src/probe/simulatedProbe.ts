import type { Diagnosis } from '@prisma/client';
import { env } from '../config/env';
import { sleep } from '../utils/sleep';
import type { NetworkProbe, ProbeContext, ProbeStageResult } from './networkProbe';

/** Small deterministic PRNG so a ticket always "behaves" the same way. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which fault does the (simulated) network actually have for this ticket? */
export function simulateFault(ctx: ProbeContext): Diagnosis {
  const r = seeded(ctx.ticketId)();
  switch (ctx.category) {
    case 'ROUTER_ISSUE': return 'ROUTER_CONFIG';
    case 'NEW_CONNECTION': return 'PROVISIONING';
    case 'NO_CONNECTION': return r < 0.7 ? 'LINE_FAULT' : 'PROVISIONING';
    case 'SLOW_SPEED': return r < 0.4 ? 'ROUTER_CONFIG' : r < 0.75 ? 'CONGESTION' : 'LINE_FAULT';
    default: return ctx.planTemplate ?? 'UNKNOWN'; // custom category: use the template the admin selected
  }
}

export class SimulatedProbe implements NetworkProbe {
  async runCheck(stage: string, ctx: ProbeContext, signal: AbortSignal): Promise<ProbeStageResult> {
    const rnd = seeded(ctx.ticketId + stage);
    // each stage "takes time" like a real remote check (real seconds, NOT scaled)
    await sleep(Math.round(env.PROBE_STAGE_MS * (0.8 + rnd() * 0.4)), signal);
    const fault = simulateFault(ctx);
    const bad = (f: Diagnosis) => fault === f;

    switch (stage) {
      case 'LINE_SYNC': {
        const sync = bad('LINE_FAULT') ? 20 + rnd() * 30 : ctx.planMbps * (1.1 + rnd() * 0.2);
        return { stage, passed: !bad('LINE_FAULT'), metrics: { syncRateMbps: round(sync), snrDb: round(bad('LINE_FAULT') ? 6 + rnd() * 4 : 18 + rnd() * 6) } };
      }
      case 'OPTICAL_POWER': {
        const rx = bad('LINE_FAULT') ? -28 - rnd() * 3 : -18 - rnd() * 4;
        return { stage, passed: rx > -27, metrics: { rxPowerDbm: round(rx) } };
      }
      case 'PACKET_LOSS_LATENCY': {
        const loss = bad('CONGESTION') || bad('LINE_FAULT') ? 3 + rnd() * 6 : rnd() * 0.5;
        return { stage, passed: loss < 1, metrics: { packetLossPct: round(loss), latencyMs: round(bad('CONGESTION') ? 120 + rnd() * 80 : 8 + rnd() * 14) } };
      }
      case 'SPEED_PROFILE': {
        const mismatch = bad('PROVISIONING');
        return { stage, passed: !mismatch, metrics: { planMbps: ctx.planMbps, provisionedMbps: mismatch ? Math.max(1, Math.round(ctx.planMbps / 5)) : ctx.planMbps } };
      }
      default:
        return { stage, passed: true, metrics: {} };
    }
  }
}

export const probe: NetworkProbe = new SimulatedProbe();

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}
