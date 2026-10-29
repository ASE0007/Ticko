import { z } from 'zod';

/** Mirrors backend/src/schemas (createTicketBody) so users get instant feedback; the server re-validates. */
export const phone = z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10-15 digits, optional leading +');

export const newCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone,
  address: z.string().trim().min(5, 'Address must be at least 5 characters').max(200),
  area: z.string().trim().max(60).optional(),
  planMbps: z.coerce.number({ invalid_type_error: 'Enter the plan speed' }).int('Whole number').min(1, 'At least 1 Mbps').max(1000, 'At most 1000 Mbps'),
});

export const ticketFormSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    customer: newCustomerSchema.optional(),
    title: z.string().trim().min(5, 'Title must be at least 5 characters').max(120, 'Title is too long'),
    description: z.string().trim().min(10, 'Please describe the problem (min 10 characters)').max(2000),
    category: z.string().min(1, 'Choose a category'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.customer), { message: 'Choose an existing customer or enter a new one', path: ['customerId'] });

export type TicketFormValues = z.input<typeof ticketFormSchema>;

/** Flatten zod issues into { 'customer.phone': 'message' }. */
export function zodErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password needs at least one letter')
  .regex(/\d/, 'Password needs at least one number');

export const userFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().min(1, 'Enter an e-mail').email('That does not look like an e-mail address'),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your e-mail').email('That does not look like an e-mail address'),
  password: z.string().min(1, 'Enter your password'),
});
