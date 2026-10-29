import type { Priority, SlaState, StepStatus, TicketStatus } from '../api/types';

export const STATUS_META: Record<TicketStatus, { label: string; cls: string }> = {
  OPEN: { label: 'New', cls: 'text-mute border-line' },
  DIAGNOSING: { label: 'Diagnosing', cls: 'text-info border-info/40 bg-info/10' },
  AWAITING_ASSIGNMENT: { label: 'Awaiting assignment', cls: 'text-warn border-warn/40 bg-warn/10' },
  ASSIGNED: { label: 'Assigned', cls: 'text-brand border-brand/40 bg-brand/10' },
  IN_PROGRESS: { label: 'In progress', cls: 'text-brand border-brand/40 bg-brand/10' },
  VERIFYING: { label: 'Verifying', cls: 'text-info border-info/40 bg-info/10' },
  RESOLVED: { label: 'Resolved', cls: 'text-ok border-ok/40 bg-ok/10' },
  CLOSED: { label: 'Closed', cls: 'text-ok border-ok/30' },
  REOPENED: { label: 'Reopened', cls: 'text-crit border-crit/40 bg-crit/10' },
  CANCELLED: { label: 'Cancelled', cls: 'text-mute border-line line-through' },
};

export const PRIORITY_META: Record<Priority, { label: string; cls: string; dot: string }> = {
  LOW: { label: 'Low', cls: 'text-mute border-line', dot: 'bg-mute' },
  MEDIUM: { label: 'Medium', cls: 'text-info border-info/40', dot: 'bg-info' },
  HIGH: { label: 'High', cls: 'text-warn border-warn/40', dot: 'bg-warn' },
  CRITICAL: { label: 'Critical', cls: 'text-crit border-crit/50 bg-crit/10', dot: 'bg-crit' },
};

export const SLA_META: Record<SlaState, { label: string; color: string; cls: string }> = {
  ON_TRACK: { label: 'On track', color: 'rgb(var(--ok))', cls: 'text-ok' },
  AT_RISK: { label: 'At risk', color: 'rgb(var(--info))', cls: 'text-info' },
  WARNING: { label: 'Warning', color: 'rgb(var(--warn))', cls: 'text-warn' },
  BREACHED: { label: 'Breached', color: 'rgb(var(--danger))', cls: 'text-danger' },
};

export const STEP_META: Record<StepStatus, { label: string; cls: string }> = {
  LOCKED: { label: 'Waiting', cls: 'text-mute border-line' },
  READY: { label: 'Ready', cls: 'text-info border-info/40 bg-info/10' },
  IN_PROGRESS: { label: 'Working', cls: 'text-brand border-brand/40 bg-brand/10' },
  DONE: { label: 'Done', cls: 'text-ok border-ok/40 bg-ok/10' },
  SKIPPED: { label: 'Skipped', cls: 'text-mute border-line line-through' },
};

export const ALL_STATUSES = Object.keys(STATUS_META) as TicketStatus[];
export const ALL_PRIORITIES = Object.keys(PRIORITY_META) as Priority[];

/** "1h 05m", "42m", "3d 4h" - input in simulated minutes. */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Simulated minutes between two instants given the demo time scale. */
export function simMinutes(fromIso: string | number | Date, to: number, scale: number): number {
  return ((to - new Date(fromIso).getTime()) * scale) / 60_000;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const OPEN_STATUSES: TicketStatus[] = ['OPEN', 'DIAGNOSING', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'VERIFYING', 'RESOLVED', 'REOPENED'];

export const PLAN_TEMPLATE_LABEL: Record<string, string> = {
  LINE_FAULT: 'Line fault (fiber inspection & repair steps)',
  ROUTER_CONFIG: 'Router / Wi-Fi (router check, config fix steps)',
  CONGESTION: 'Congestion (node & QoS steps)',
  PROVISIONING: 'Provisioning (account & profile steps)',
  UNKNOWN: 'General (on-site inspection & fault isolation)',
};

/** The steps each work plan creates, in plain words (shown next to the plan choice). */
export const PLAN_TEMPLATE_STEPS: Record<string, string> = {
  LINE_FAULT: 'Inspect the fiber line → Repair the faulty part → Check the signal again → Speed test → Confirm with the customer',
  ROUTER_CONFIG: 'Check the router (and Wi-Fi interference at the same time) → Fix the settings → Speed test → Confirm with the customer',
  CONGESTION: 'Check how busy the node is → Balance the traffic → Speed test → Confirm with the customer',
  PROVISIONING: 'Check the customer account → Set up the service profile again → Test the connection → Confirm with the customer',
  UNKNOWN: 'Inspect on site → Find the fault → Speed test → Confirm with the customer',
};

/** Same rule as the server: used to warn about a category that already exists before the form is sent. */
export const categoryCode = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export function findSimilarCategory<T extends { code: string; name: string }>(name: string, cats: T[]): T | undefined {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return undefined;
  const code = categoryCode(name);
  return cats.find((c) => c.name.trim().toLowerCase() === n || c.code === code);
}

export const toLocalDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** [local midnight, next local midnight) as ISO strings for the API. */
export function dayRange(dateInput: string): { from: string; to: string } {
  const [y, m, d] = dateInput.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}
export const fmtClock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
