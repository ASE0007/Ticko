import { z } from 'zod';

const uuid = z.string().uuid();
export const Priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const Category = z.string().trim().min(2).max(60); // code of an active category (checked against the DB in the service)
export const TicketStatus = z.enum(['OPEN', 'DIAGNOSING', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'VERIFYING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED']);
export const SlaState = z.enum(['ON_TRACK', 'AT_RISK', 'WARNING', 'BREACHED']);
export const Skill = z.enum(['NETWORK', 'ROUTER', 'FIBER', 'WIFI', 'GENERAL']);
export const Role = z.enum(['OPERATOR', 'SUPERVISOR', 'TECHNICIAN', 'ADMIN']);

export const idParam = z.object({ id: uuid });
export const tokenParam = z.object({ token: z.string().min(16).max(128) });

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10-15 digits, optional leading +');

export const newCustomer = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  address: z.string().trim().min(5).max(200),
  area: z.string().trim().max(60).optional(),
  planMbps: z.number().int().min(1).max(1000),
});

export const patchCustomerBody = newCustomer.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createTicketBody = z
  .object({
    customerId: uuid.optional(),
    customer: newCustomer.optional(),
    title: z.string().trim().min(5, 'Title must be at least 5 characters').max(120),
    description: z.string().trim().min(10, 'Please describe the problem (min 10 characters)').max(2000),
    category: Category,
    priority: Priority,
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.customer), {
    message: 'Provide either customerId or customer details',
    path: ['customerId'],
  });

export const updateTicketBody = z
  .object({
    title: z.string().trim().min(5).max(120).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    category: Category.optional(),
    priority: Priority.optional(),
    version: z.number().int().min(1),
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'Nothing to update' });

const csv = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(inner));

export const listTicketsQuery = z.object({
  status: csv(TicketStatus).optional(),
  priority: csv(Priority).optional(),
  category: csv(Category).optional(),
  slaState: csv(SlaState).optional(),
  technicianId: uuid.optional(),
  unassigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['createdAt', 'priority', 'slaDeadline', 'number', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const assignBody = z.object({ technicianId: uuid, version: z.number().int().min(1), note: z.string().max(300).optional() });
export const helperBody = z.object({ technicianId: uuid });
export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(300) });
export const reopenBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const confirmBody = z.object({ note: z.string().trim().max(300).optional() });
export const verifyBody = z.object({ simulate: z.enum(['PASS', 'FAIL']).optional() });

export const createStepBody = z.object({
  title: z.string().trim().min(3).max(120),
  estimatedMinutes: z.number().int().min(1).max(1440),
  /** run AFTER these steps finish (leave empty = can start immediately, in parallel) */
  dependsOn: z.array(uuid).max(10).default([]),
  /** insert into the chain right after this step: steps that were waiting for it will wait for the new step */
  insertAfter: uuid.optional(),
  requiredSkill: Skill.optional(),
  assigneeId: uuid.optional(),
});
export const patchStepBody = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).optional(),
  dependsOn: z.array(uuid).max(10).optional(),
  assigneeId: uuid.nullable().optional(),
  version: z.number().int().min(1),
});
export const completeStepBody = z.object({ note: z.string().trim().max(300).optional() });

export const availabilityBody = z.object({ availability: z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY']) });

export const slaPoliciesBody = z.object({
  policies: z
    .array(
      z.object({
        priority: Priority,
        resolutionMinutes: z.number().int().min(1).max(100_000),
        warningPct: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
});

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password needs at least one letter')
  .regex(/\d/, 'Password needs at least one number');

export const createUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password,
  role: Role,
  skills: z.array(Skill).default([]),
  maxActive: z.number().int().min(1).max(20).optional(),
});
export const patchUserBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    password: password.optional(),
    role: Role.optional(),
    active: z.boolean().optional(),
    skills: z.array(Skill).optional(),
    maxActive: z.number().int().min(1).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const createCategoryBody = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  description: z.string().trim().max(200).optional(),
  planTemplate: z.enum(['LINE_FAULT', 'ROUTER_CONFIG', 'CONGESTION', 'PROVISIONING', 'UNKNOWN']).optional(),
  defaultPriority: Priority.optional(),
});
export const patchCategoryBody = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    planTemplate: z.enum(['LINE_FAULT', 'ROUTER_CONFIG', 'CONGESTION', 'PROVISIONING', 'UNKNOWN']).optional(),
    defaultPriority: Priority.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const codeParam = z.object({ code: z.string().min(2).max(60) });

export const dayRangeQuery = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: '"to" must be after "from"', path: ['to'] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 32 * 86_400_000, { message: 'Range is limited to 31 days', path: ['to'] });
export const throughputQuery = z.object({ hours: z.coerce.number().int().min(1).max(72).default(12) });

export const jobsQuery = z.object({
  status: csv(z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const reportExportBody = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
export const trackReportBody = z.object({ note: z.string().trim().max(300).optional() });
