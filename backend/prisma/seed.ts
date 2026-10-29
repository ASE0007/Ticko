/**
 * Idempotent seed: safe to run on every container start.
 * Creates reference data only (users, technicians, customers, SLA policies).
 * Demo tickets are created through the real API (npm run demo:traffic, added later)
 * so that all business rules and live events are exercised.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Priority, PrismaClient, Role, Skill } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = new URL(process.env.DATABASE_URL ?? '');
const schema = dbUrl.searchParams.get('schema') ?? 'public';
dbUrl.searchParams.delete('schema');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl.toString() }, { schema }) });
const DEMO_PASSWORD = 'Passw0rd!';
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_TICKETS ?? 2);
const COST = Number(process.env.BCRYPT_COST ?? 10);

const users: { name: string; email: string; role: Role }[] = [
  { name: 'Admin Anika', email: 'admin@tixory.test', role: 'ADMIN' },
  { name: 'Supervisor Sabbir', email: 'supervisor@tixory.test', role: 'SUPERVISOR' },
  { name: 'Operator Mim', email: 'operator1@tixory.test', role: 'OPERATOR' },
  { name: 'Operator Tanvir', email: 'operator2@tixory.test', role: 'OPERATOR' },
];

const technicians: { name: string; email: string; skills: Skill[] }[] = [
  { name: 'Rafi Ahmed', email: 'rafi@tixory.test', skills: ['NETWORK', 'FIBER'] },
  { name: 'Nusrat Jahan', email: 'nusrat@tixory.test', skills: ['ROUTER', 'WIFI'] },
  { name: 'Imran Hossain', email: 'imran@tixory.test', skills: ['GENERAL', 'ROUTER'] },
  { name: 'Sadia Rahman', email: 'sadia@tixory.test', skills: ['FIBER', 'NETWORK', 'GENERAL'] },
];

const customers = [
  { accountNo: 'ACC-1001', name: 'Karim Uddin', phone: '+8801711000001', address: 'House 12, Road 5, Mirpur DOHS', area: 'Mirpur', planMbps: 50 },
  { accountNo: 'ACC-1002', name: 'Farhana Akter', phone: '+8801711000002', address: 'Flat 4B, Sector 7, Uttara', area: 'Uttara', planMbps: 100 },
  { accountNo: 'ACC-1003', name: 'Hasan Mahmud', phone: '+8801711000003', address: '45 Green Road, Dhanmondi', area: 'Dhanmondi', planMbps: 30 },
  { accountNo: 'ACC-1004', name: 'Shirin Sultana', phone: '+8801711000004', address: 'Road 11, Block C, Banani', area: 'Banani', planMbps: 100 },
  { accountNo: 'ACC-1005', name: 'Mizanur Rahman', phone: '+8801711000005', address: 'Level 3, Bashundhara R/A', area: 'Bashundhara', planMbps: 20 },
  { accountNo: 'ACC-1006', name: 'Tasnim Chowdhury', phone: '+8801711000006', address: 'House 8, Lalmatia Block D', area: 'Lalmatia', planMbps: 50 },
  { accountNo: 'ACC-1007', name: 'Arif Hossain', phone: '+8801711000007', address: 'Flat 2A, Mohammadpur', area: 'Mohammadpur', planMbps: 30 },
  { accountNo: 'ACC-1008', name: 'Nabila Karim', phone: '+8801711000008', address: 'Road 27, Gulshan 1', area: 'Gulshan', planMbps: 100 },
  { accountNo: 'ACC-1009', name: 'Rubel Mia', phone: '+8801711000009', address: 'Shyamoli Ring Road', area: 'Shyamoli', planMbps: 20 },
  { accountNo: 'ACC-1010', name: 'Dilruba Yasmin', phone: '+8801711000010', address: 'Khilgaon Chowdhurypara', area: 'Khilgaon', planMbps: 50 },
];

// Resolution targets by priority (minutes). Configurable by Admin later.
const slaPolicies: { priority: Priority; resolutionMinutes: number; warningPct: number }[] = [
  { priority: 'CRITICAL', resolutionMinutes: 240, warningPct: 75 },
  { priority: 'HIGH', resolutionMinutes: 480, warningPct: 75 },
  { priority: 'MEDIUM', resolutionMinutes: 1440, warningPct: 75 },
  { priority: 'LOW', resolutionMinutes: 2880, warningPct: 75 },
];

const categories = [
  { code: 'SLOW_SPEED', name: 'Slow speed', description: 'Internet works but is much slower than the plan', planTemplate: 'UNKNOWN', defaultPriority: 'MEDIUM', sortOrder: 1 },
  { code: 'NO_CONNECTION', name: 'No connection', description: 'No internet at all (LOS, link down)', planTemplate: 'LINE_FAULT', defaultPriority: 'HIGH', sortOrder: 2 },
  { code: 'ROUTER_ISSUE', name: 'Router issue', description: 'Router reboots, Wi-Fi drops, configuration', planTemplate: 'ROUTER_CONFIG', defaultPriority: 'MEDIUM', sortOrder: 3 },
  { code: 'NEW_CONNECTION', name: 'New connection', description: 'Newly installed service not working', planTemplate: 'PROVISIONING', defaultPriority: 'MEDIUM', sortOrder: 4 },
  { code: 'BILLING_LINK', name: 'Billing link', description: 'Service blocked or limited because of billing', planTemplate: 'PROVISIONING', defaultPriority: 'LOW', sortOrder: 5 },
  { code: 'OTHER', name: 'Other', description: 'Anything else', planTemplate: 'UNKNOWN', defaultPriority: 'LOW', sortOrder: 6 },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, COST);

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: { ...u, passwordHash },
    });
  }

  for (const t of technicians) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: { name: t.name, role: 'TECHNICIAN' },
      create: { name: t.name, email: t.email, role: 'TECHNICIAN', passwordHash },
    });
    await prisma.technician.upsert({
      where: { userId: user.id },
      update: { skills: t.skills }, // never reset active_tickets on re-seed
      create: { userId: user.id, skills: t.skills, maxActive: MAX_ACTIVE },
    });
  }

  for (const c of customers) {
    await prisma.customer.upsert({ where: { accountNo: c.accountNo }, update: {}, create: c });
  }

  for (const c of categories) {
    await prisma.category.upsert({ where: { code: c.code }, update: {}, create: { ...c, builtin: true } });
  }

  for (const p of slaPolicies) {
    await prisma.slaPolicy.upsert({ where: { priority: p.priority }, update: {}, create: p });
  }

  const counts = {
    users: await prisma.user.count(),
    technicians: await prisma.technician.count(),
    customers: await prisma.customer.count(),
    slaPolicies: await prisma.slaPolicy.count(),
  };
  console.log('Seed complete:', counts, `(demo password: ${DEMO_PASSWORD})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
