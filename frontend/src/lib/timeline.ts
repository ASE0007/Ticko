import type { TimelineItem } from '../api/types';

const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;
const first = (name: string) => (name === 'System' ? 'The system' : name);
const lower = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/**
 * Turns the raw audit message stored by the server into one short, plain sentence.
 * Unknown messages are returned unchanged, so nothing is ever hidden.
 */
export function humanizeTimeline(it: Pick<TimelineItem, 'message' | 'actor' | 'from' | 'to'>): string {
  const m = (it.message ?? '').trim();
  const who = first(it.actor);
  if (!m) return `${who} changed the status from ${lower(it.from ?? 'none')} to ${lower(it.to)}.`;
  let r: RegExpExecArray | null;

  if ((r = /^Completed: (.+?) - estimated (\d+) min, actual (\d+) min(?: \(\+(\d+) min over\))?(?:\. Note: (.*))?$/s.exec(m))) {
    const [, title, est, act, , note] = r as unknown as [string, string, string, string, string, string | undefined];
    const e = Number(est), a = Number(act);
    const time = a > e ? `It took ${mins(a)}, which is ${mins(a - e)} more than the ${mins(e)} planned.`
      : a < e ? `It took ${mins(a)}, faster than the ${mins(e)} planned.` : `It took ${mins(a)}, exactly as planned.`;
    return `${who} finished the step “${title}”. ${time}${note ? ` Note: ${note}` : ''}`;
  }
  if ((r = /^Started: (.+)$/s.exec(m))) return `${who} started the step “${r[1]}”.`;
  if ((r = /^Skipped: (.+)$/s.exec(m))) return `${who} skipped the step “${r[1]}”.`;
  if ((r = /^Step added after #(\d+): (.+) \((\d+) min\)$/s.exec(m))) return `${who} added a new step “${r[2]}” (about ${mins(Number(r[3]))}) right after step ${r[1]}.`;
  if ((r = /^Step added: (.+) \((\d+) min\)$/s.exec(m))) return `${who} added a new step “${r[1]}” (about ${mins(Number(r[2]))}).`;
  if ((r = /^Step edited: (.+)$/s.exec(m))) return `${who} changed the step “${r[1]}”.`;
  if (m === 'Ticket created') return `${who} created this ticket.`;
  if (m === 'Work started') return 'Work on this ticket has started.';
  if (m === 'Automatic line diagnostics started') return 'The system started checking the customer’s line.';
  if ((r = /^Diagnosis: (.+?)\. Work plan generated \((\d+) steps?\)\.$/s.exec(m))) return `The line check is done. The problem looks like: ${lower(r[1] as string)}. A work plan with ${r[2]} steps was made.`;
  if (m === 'Automatic diagnostics failed; manual triage required') return 'The automatic line check failed. A supervisor needs to look at this ticket.';
  if ((r = /^Reassigned to (.+)$/s.exec(m))) return `${who} moved this ticket to ${r[1]}.`;
  if ((r = /^Assigned to (.+)$/s.exec(m))) return `${who} gave this ticket to ${r[1]}.`;
  if ((r = /^Owner: (.+?)(?: \((.*)\))?$/s.exec(m))) return `${r[1]} is now the main technician${r[2] ? ` (note: ${r[2]})` : ''}.`;
  if ((r = /^Helper added: (.+)$/s.exec(m))) return `${who} added ${r[1]} as a helper.`;
  if (m === 'Technician finished work; automatic speed verification requested') return `${who} finished the work. The system will now test the customer’s speed.`;
  if ((r = /^Speed verified: (\d+) Mbps of (\d+) Mbps plan\./.exec(m))) return `Speed test passed: ${r[1]} Mbps out of ${r[2]} Mbps. Now waiting for the customer to confirm.`;
  if ((r = /^Verification FAILED: (\d+) Mbps of (\d+) Mbps plan\./.exec(m))) return `Speed test failed: only ${r[1]} Mbps out of ${r[2]} Mbps. The technician must check again.`;
  if (m === 'Automatic verification could not run; supervisor attention needed') return 'The speed test could not run. A supervisor needs to check this ticket.';
  if (m === 'Verification job failed after retries') return 'The speed test failed even after trying again.';
  if (/^Customer confirmed the issue is fixed/.test(m)) return 'The customer confirmed the problem is fixed using the tracking link.';
  if ((r = /^Customer confirmed fixed(?:: (.*))?$/s.exec(m))) return `${who} recorded that the customer confirmed the problem is fixed.${r[1] ? ` Note: ${r[1]}` : ''}`;
  if ((r = /^Auto-closed after (\d+)h/.exec(m))) return `The ticket closed by itself because the customer did not reply for ${r[1]} hours.`;
  if ((r = /^Reopened by customer: (.*)$/s.exec(m))) return `The customer said the problem is not fixed. Reason: ${r[1]}`;
  if ((r = /^Reopened: (.*)$/s.exec(m))) return `${who} reopened this ticket. Reason: ${r[1]}`;
  if ((r = /^Cancelled: (.*)$/s.exec(m))) return `${who} cancelled this ticket. Reason: ${r[1]}`;
  if ((r = /^Edited: (.*)$/s.exec(m))) return `${who} edited the ticket (${r[1]}).`;
  if (m === 'Edited') return `${who} edited the ticket.`;
  if ((r = /^Overrun: "(.+)" reached (.+?) of its (\d+)-minute estimate$/s.exec(m))) return `The step “${r[1]}” is taking longer than planned. It has used ${r[2]} of its ${mins(Number(r[3]))} estimate.`;
  if ((r = /^SLA (.+)$/s.exec(m))) return `Deadline status changed: ${r[1]}.`;
  if ((r = /^Priority auto-escalated (\w+) -> (\w+)/.exec(m))) return `The priority was raised automatically from ${lower(r[1] as string)} to ${lower(r[2] as string)} because the deadline is close.`;
  if (m === 'SLA warning at highest priority') return 'The deadline is close, and the priority is already at the highest level.';
  return m;
}
