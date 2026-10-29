import { env } from '../config/env';

/**
 * Business time helper.
 *
 * All stored timestamps are REAL wall-clock instants (no jumps after restarts).
 * Only DURATIONS of human work are scaled: with DEMO_TIME_SCALE=60,
 * one real second counts as one simulated minute. Used for step elapsed time,
 * SLA windows and auto-close, so overruns/breaches can be demoed in minutes.
 */
export interface Clock {
  readonly scale: number;
  now(): Date;
  /** Simulated minutes elapsed between two instants. */
  simMinutes(from: Date, to?: Date): number;
  /** The real instant that is `simMinutes` of simulated time after `from`. */
  addSimMinutes(from: Date, simMinutes: number): Date;
}

export class ScaledClock implements Clock {
  constructor(public readonly scale: number = 1) {}

  now(): Date {
    return new Date();
  }

  simMinutes(from: Date, to: Date = this.now()): number {
    return ((to.getTime() - from.getTime()) * this.scale) / 60_000;
  }

  addSimMinutes(from: Date, simMinutes: number): Date {
    return new Date(from.getTime() + (simMinutes * 60_000) / this.scale);
  }
}

export const clock: Clock = new ScaledClock(env.DEMO_TIME_SCALE);
