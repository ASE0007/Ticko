import type { Technician, Ticket, WsMessage } from '../api/types';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { useAuth } from '../store/auth';

const TICKET_EVENTS = new Set([
  'ticket.created', 'ticket.updated', 'ticket.status_changed', 'ticket.assigned', 'ticket.cancelled',
  'ticket.closed', 'ticket.reopened', 'forecast.updated',
]);

/**
 * Single place where server events turn into state changes.
 * Components never talk to the socket: they just read the stores (state management).
 */
export function applyEvent(msg: WsMessage): void {
  const data = useData.getState();
  const ui = useUi.getState();
  const me = useAuth.getState().user;
  const p = msg.payload ?? {};
  const isStaff = !!me && me.role !== 'TECHNICIAN';

  if (TICKET_EVENTS.has(msg.type) && p.ticket) {
    const t = p.ticket as Ticket;
    data.upsertTicket(t);
    if (msg.type === 'forecast.updated' && p.forecast) {
      data.setSteps(t.id, data.steps[t.id] ?? [], {
        finish: p.forecast.finish, estimatedTotalMin: p.forecast.estimatedTotalMin, actualTotalMin: p.forecast.actualTotalMin,
      });
    }
    switch (msg.type) {
      case 'ticket.created':
        data.log({ kind: 'info', text: `${t.ticketNo} filed: ${t.title}`, ticketId: t.id });
        if (isStaff) ui.toast({ kind: 'info', title: `New ticket ${t.ticketNo}`, text: t.title, ticketId: t.id });
        break;
      case 'ticket.status_changed': {
        data.log({ kind: p.to === 'RESOLVED' ? 'ok' : 'info', text: `${t.ticketNo}: ${String(p.from ?? '').replaceAll('_', ' ') || '…'} → ${String(p.to).replaceAll('_', ' ')}`, ticketId: t.id });
        if (p.verification && !p.verification.passed) ui.toast({ kind: 'warn', title: `${t.ticketNo} failed verification`, text: `${p.verification.measuredMbps} of ${p.verification.planMbps} Mbps. Back to technician.`, ticketId: t.id });
        else if (p.to === 'RESOLVED') ui.toast({ kind: 'ok', title: `${t.ticketNo} verified & resolved`, text: 'Waiting for customer confirmation', ticketId: t.id });
        break;
      }
      case 'ticket.assigned':
        data.log({ kind: 'info', text: `${t.ticketNo} assigned to ${t.technician?.name ?? '…'}`, ticketId: t.id });
        if (me?.role === 'TECHNICIAN' && t.technician?.id === me.technicianId) ui.toast({ kind: 'info', title: `New assignment ${t.ticketNo}`, text: t.title, ticketId: t.id });
        break;
      case 'ticket.reopened':
        data.log({ kind: 'warn', text: `${t.ticketNo} reopened: ${p.reason ?? ''}`, ticketId: t.id });
        if (isStaff) ui.toast({ kind: 'warn', title: `${t.ticketNo} reopened`, text: p.reason, ticketId: t.id });
        break;
      case 'ticket.closed':
        data.log({ kind: 'ok', text: `${t.ticketNo} closed (${p.source ?? 'customer'})`, ticketId: t.id });
        break;
      case 'ticket.cancelled':
        data.log({ kind: 'warn', text: `${t.ticketNo} cancelled: ${p.reason ?? ''}`, ticketId: t.id });
        break;
      case 'ticket.updated':
        if (p.reason === 'escalated') {
          data.log({ kind: 'warn', text: `${t.ticketNo} priority escalated ${p.from} → ${p.to}`, ticketId: t.id });
          if (isStaff) ui.toast({ kind: 'warn', title: `${t.ticketNo} escalated to ${p.to}`, text: 'SLA warning reached', ticketId: t.id });
        }
        break;
    }
    return;
  }

  switch (msg.type) {
    case 'job.queued':
      data.upsertJob({ jobId: p.job.id, ticketId: p.job.ticketId, type: p.job.type, status: 'QUEUED', progress: 0, stage: 'Queued', priorityRank: p.job.priorityRank });
      break;
    case 'job.started':
    case 'job.retrying':
    case 'job.completed':
    case 'job.failed':
    case 'job.cancelled': {
      const j = p.job;
      data.upsertJob({ jobId: j.id, ticketId: j.ticketId, type: j.type, status: j.status, progress: j.progress, stage: j.stage, priorityRank: j.priorityRank });
      if (msg.type === 'job.failed') ui.toast({ kind: 'danger', title: 'Background job failed', text: j.error ?? j.type, ticketId: j.ticketId ?? undefined });
      break;
    }
    case 'job.progress': {
      data.upsertJob({ jobId: p.jobId, ticketId: p.ticketId, type: p.type, status: 'RUNNING', progress: p.progress, stage: p.stage });
      const t = p.ticketId ? useData.getState().tickets[p.ticketId] : undefined;
      if (t && typeof p.ticketProgress === 'number') data.upsertTicket({ ...t, progress: p.ticketProgress, updatedAt: new Date().toISOString() });
      break;
    }
    case 'job.alert':
      ui.toast({ kind: 'danger', title: 'Supervisor attention needed', text: p.message, ticketId: p.ticketId });
      data.log({ kind: 'danger', text: p.message, ticketId: p.ticketId });
      break;
    case 'step.updated':
      data.setSteps(p.ticketId, p.steps, p.forecast);
      break;
    case 'step.overrun':
      data.log({ kind: 'warn', text: `${p.ticketNo}: "${p.title}" at ${p.multiple}× its ${p.estimatedMinutes}-min estimate`, ticketId: p.ticketId });
      ui.toast({ kind: p.level >= 3 ? 'danger' : 'warn', title: `${p.ticketNo} step overrun (${p.multiple}×)`, text: p.suggestion ?? `"${p.title}" is over its ${p.estimatedMinutes}-min estimate`, ticketId: p.ticketId });
      break;
    case 'sla.at_risk':
    case 'sla.warning':
    case 'sla.breached': {
      const kind = msg.type === 'sla.breached' ? 'danger' : 'warn';
      const label = msg.type === 'sla.at_risk' ? 'predicted to miss its SLA' : msg.type === 'sla.warning' ? 'SLA warning' : 'SLA BREACHED';
      data.log({ kind, text: `${p.ticketNo}: ${label}`, ticketId: p.ticketId });
      if (isStaff) ui.toast({ kind, title: `${p.ticketNo}: ${label}`, ticketId: p.ticketId });
      break;
    }
    case 'technician.updated':
      data.upsertTechnician(p.technician as Technician);
      break;
    case 'metrics.updated':
      data.setMetrics(p.metrics);
      break;
    case 'presence.updated':
      data.setOnline(p.online);
      break;
  }
}
