export type Role = 'OPERATOR' | 'SUPERVISOR' | 'TECHNICIAN' | 'ADMIN';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketStatus = 'OPEN' | 'DIAGNOSING' | 'AWAITING_ASSIGNMENT' | 'ASSIGNED' | 'IN_PROGRESS' | 'VERIFYING' | 'RESOLVED' | 'CLOSED' | 'REOPENED' | 'CANCELLED';
/** category code (built-in or created by a manager) */
export type Category = string;
export type SlaState = 'ON_TRACK' | 'AT_RISK' | 'WARNING' | 'BREACHED';
export type StepStatus = 'LOCKED' | 'READY' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type Skill = 'NETWORK' | 'ROUTER' | 'FIBER' | 'WIFI' | 'GENERAL';
export type Availability = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';

export interface User { id: string; name: string; email?: string; role: Role; technicianId: string | null }

export interface Customer { id: string; accountNo: string; name: string; phone: string; address: string; area: string | null; planMbps: number; ticketCount?: number }

export interface Ticket {
  id: string; number: number; ticketNo: string; title: string; description: string;
  category: Category; categoryName: string; priority: Priority; escalated: boolean; status: TicketStatus; progress: number;
  diagnosis: string | null; slaState: SlaState; slaStartedAt: string; slaDeadline: string; forecastFinish: string | null;
  estimatedTotalMin: number; actualTotalMin: number; reopenCount: number; cancelReason: string | null;
  version: number; createdAt: string; updatedAt: string; resolvedAt: string | null; closedAt: string | null;
  customer: Customer; technician: { id: string; name: string; skills: Skill[] } | null;
}

export interface Step {
  id: string; ticketId: string; seq: number; title: string; status: StepStatus;
  estimatedMinutes: number; actualMinutes: number | null; requiredSkill: Skill | null;
  assigneeId: string | null; assigneeName: string | null; startedAt: string | null; completedAt: string | null;
  dependsOn: string[]; version: number; elapsedMinutes: number; etaMinutes: number; overrunLevel: number; overrun: boolean;
}

export interface Forecast { finish: string | null; estimatedTotalMin: number; actualTotalMin: number }

export interface Job {
  id: string; ticketId: string | null; type: 'DIAGNOSE_LINE' | 'VERIFY_SPEED' | 'EXPORT_REPORT';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; priorityRank: number; progress: number;
  stage: string | null; attempts: number; maxAttempts: number; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; ticketNo?: string | null; ticketTitle?: string | null;
}

export interface Technician {
  id: string; userId: string; name: string; email: string; skills: Skill[]; availability: Availability;
  activeTickets: number; maxActive: number; atCapacity: boolean;
  currentTickets?: { id: string; ticketNo: string; title: string; status: TicketStatus; priority: Priority; progress: number; slaState: SlaState }[];
}

export interface Metrics {
  tickets: { open: number; createdLast24h: number; resolvedLast24h: number; byStatus: Record<string, number>; unassigned: number };
  sla: { onTrack: number; atRisk: number; warning: number; breached: number };
  queue: { queued: number; running: number; concurrency: number; utilisation: number; jobsPerMin: number; succeeded: number; failed: number; cancelled: number; retried: number };
  technicians: { count: number; activeTickets: number; capacity: number; utilisationPct: number };
  realtime: { clients: number };
  config: { timeScale: number; demoMode: boolean; maxActiveTickets: number };
}

export interface TimelineItem { id: string; entity: string; from: string | null; to: string; message: string | null; actor: string; actorRole: string | null; createdAt: string }
export interface Suggestion { technician: Technician; score: number; reasons: string[]; canAssign: boolean }
export interface Assignment { id: string; technicianId: string; technicianName: string; role: 'PRIMARY' | 'HELPER'; assignedAt: string; releasedAt: string | null; note: string | null }

export interface TicketDetail {
  ticket: Ticket; steps: Step[]; forecast: Forecast; jobs: Job[]; assignments: Assignment[]; trackToken: string | null;
}

export interface Page<T> { items: T[]; page: number; limit: number; total: number; totalPages: number }

export interface AppConfig { timeScale: number; demoMode: boolean; maxActiveTickets: number; verifyPassThreshold: number; autoCloseHours: number }

export interface PublicTicket {
  ticketNo: string; title: string; category: Category; categoryName?: string; status: TicketStatus; progress: number; forecastFinish: string | null;
  createdAt: string; resolvedAt: string | null; closedAt: string | null; technicianFirstName: string | null; customerFirstName: string; planMbps: number;
}
export interface Tracking { ticket: PublicTicket; timeline: { status: string; at: string }[]; customerCanRespond: boolean }

export interface ReportSummary {
  total: number; resolved: number; avgResolutionMin: number; slaCompliancePct: number; reopenRatePct: number;
  estimateAccuracy: { estimatedMin: number; actualMin: number; ratio: number; stepsMeasured: number };
  byCategory: Record<string, number>; byPriority: Record<string, number>; byStatus: Record<string, number>;
  technicians: { name: string; resolved: number; avgResolutionMin: number }[];
}

export interface WsMessage { seq: number; type: string; ts: string; room?: string; payload: any }

export type PlanTemplate = 'LINE_FAULT' | 'ROUTER_CONFIG' | 'CONGESTION' | 'PROVISIONING' | 'UNKNOWN';
export interface CategoryInfo {
  code: string; name: string; description: string | null; planTemplate: PlanTemplate; defaultPriority: Priority;
  active: boolean; builtin: boolean; sortOrder: number; ticketCount?: number;
}

export interface UserRow {
  id: string; name: string; email: string; role: Role; active: boolean; createdAt: string;
  technicianId: string | null; skills: Skill[]; maxActive: number | null; activeTickets: number | null; availability: Availability | null;
}

export interface DayItem {
  stepId: string; ticketId: string; ticketNo: string; ticketTitle: string; priority: Priority; customer: string; area: string | null;
  step: string; seq: number; status: 'IN_PROGRESS' | 'DONE'; startedAt: string; completedAt: string | null;
  estimatedMinutes: number; actualMinutes: number; overrunMinutes: number; overrun: boolean; note: string | null;
}
export interface DaySummary {
  stepsCompleted: number; stepsInProgress: number; ticketsWorked: number; ticketsAssigned: number; ticketsResolved: number;
  estimatedMinutes: number; actualMinutes: number; accuracyPct: number | null; overrunSteps: number; overrunMinutes: number;
  activeMinutes: number; idleMinutes: number; firstActivity: string | null; lastActivity: string | null;
}
export interface DayReport {
  technician: { id: string; name: string; email: string; skills: Skill[] };
  range: { from: string; to: string };
  summary: DaySummary; items: DayItem[];
  assignedTickets: { ticketNo: string; title: string; at: string }[];
  resolvedTickets: { id: string; ticketNo: string; title: string; at: string; sla: SlaState }[];
}
export interface TeamDayRow extends DaySummary { technicianId: string; name: string; active: boolean }
export interface SlaPolicyRow { priority: Priority; resolutionMinutes: number; warningPct: number }
