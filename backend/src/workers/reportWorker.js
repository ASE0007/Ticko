'use strict';
// Runs on its own OS thread (worker_threads). Pure JS so it works from src/ (tsx) and dist/.
const { parentPort, workerData } = require('node:worker_threads');

const { rows, scale } = workerData;
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const header = ['Ticket', 'Status', 'Priority', 'Category', 'SLA', 'Customer', 'Phone', 'Technician', 'Created', 'Resolved', 'SLA deadline', 'Resolution (sim min)', 'Estimated (min)', 'Actual (min)', 'Reopens'];

let resolved = 0, breached = 0, resTotal = 0, est = 0, act = 0;
const lines = [header.join(',')];
for (const r of rows) {
  let resMin = '';
  if (r.resolvedAt) {
    resMin = Math.round(((Date.parse(r.resolvedAt) - Date.parse(r.createdAt)) * scale) / 60000);
    resolved++;
    resTotal += resMin;
    if (Date.parse(r.resolvedAt) > Date.parse(r.slaDeadline)) breached++;
  }
  est += r.estimatedMin;
  act += r.actualMin;
  lines.push([r.ticketNo, r.status, r.priority, r.category, r.slaState, r.customer, r.phone, r.technician, r.createdAt, r.resolvedAt, r.slaDeadline, resMin, r.estimatedMin, r.actualMin, r.reopenCount].map(esc).join(','));
}
parentPort.postMessage({
  csv: lines.join('\n'),
  summary: {
    tickets: rows.length,
    resolved,
    avgResolutionMin: resolved ? Math.round(resTotal / resolved) : 0,
    slaCompliancePct: resolved ? Math.round(((resolved - breached) / resolved) * 100) : 100,
    estimatedMin: est,
    actualMin: act,
  },
});
