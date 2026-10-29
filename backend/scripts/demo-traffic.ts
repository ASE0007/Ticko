/**
 * Live demo driver: simulates a busy ISP service desk through the PUBLIC REST API.
 *   operator   -> files new complaints
 *   supervisor -> assigns tickets using the system's technician suggestions
 *   technicians-> start / complete steps (about 30% of steps overrun their estimate)
 *   operator   -> confirms (or reopens) resolved tickets
 * Everything you see on the dashboard is real: REST calls -> DB -> WebSocket pushes.
 *
 *   npm run demo:traffic -- --interval=10 --max-open=8 --duration=0
 * Tip: run the backend with DEMO_TIME_SCALE=60 so "20 minutes" of work takes 20 real seconds.
 */
const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const BASE = process.env.API_URL ?? 'http://localhost:4000';
const INTERVAL_S = arg('interval', 10);
const MAX_OPEN = arg('max-open', 8);
const DURATION_S = arg('duration', 0);
const PASSWORD = 'Passw0rd!';

type Json = any;
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: Json }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
async function login(email: string) {
  const r = await call(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email} failed (${r.status}). Did you run the seed?`);
  return r.data.token as string;
}
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)] as T;
const log = (who: string, msg: string) => console.log(`${new Date().toLocaleTimeString()}  [${who.padEnd(10)}] ${msg}`);

const PROBLEMS = [
  ['Internet very slow in the evening', 'Speed drops to a fraction of the plan after 8 PM every day', 'SLOW_SPEED'],
  ['No internet since morning', 'Router shows red LOS light, no connection at all', 'NO_CONNECTION'],
  ['Router keeps rebooting', 'Router restarts every few minutes, Wi-Fi drops constantly', 'ROUTER_ISSUE'],
  ['New connection not working', 'Installed yesterday but cannot browse, PPPoE login fails', 'NEW_CONNECTION'],
  ['Wi-Fi drops in the bedroom', 'Signal is weak and disconnects randomly in the far rooms', 'ROUTER_ISSUE'],
  ['Corporate site outage', 'Whole office lost connectivity, urgent business impact', 'NO_CONNECTION'],
] as const;

async function main() {
  const cfg = (await call(await login('operator1@tixory.test'), 'GET', '/config')).data;
  const scale: number = cfg.timeScale;
  log('system', `Connected to ${BASE}  (time scale x${scale}, max-open ${MAX_OPEN}, new ticket every ~${INTERVAL_S}s)`);
  const op = await login('operator1@tixory.test');
  const sup = await login('supervisor@tixory.test');
  const techs = await Promise.all(['rafi', 'nusrat', 'imran', 'sadia'].map(async (n) => ({ name: n, token: await login(`${n}@tixory.test`) })));
  const customers: Json[] = (await call(op, 'GET', '/customers')).data.items;

  const dueAt = new Map<string, number>(); // stepId -> epoch ms when the "technician" finishes
  const resolvedSeen = new Map<string, number>();
  const t0 = Date.now();
  let lastCreated = 0;

  for (;;) {
    if (DURATION_S && Date.now() - t0 > DURATION_S * 1000) break;
    try {
      // 1) operator files complaints
      const open = (await call(sup, 'GET', '/metrics')).data.tickets.open as number;
      if (open < MAX_OPEN && Date.now() - lastCreated > INTERVAL_S * 1000) {
        const [title, description, category] = pick([...PROBLEMS]);
        const priority = pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL']);
        const r = await call(op, 'POST', '/tickets', { customerId: pick(customers).id, title, description, category, priority });
        if (r.status === 201) { lastCreated = Date.now(); log('operator', `filed ${r.data.ticket.ticketNo} ${priority} - ${title}`); }
      }

      // 2) supervisor assigns using the suggestion engine
      const waiting = (await call(sup, 'GET', '/tickets?status=AWAITING_ASSIGNMENT,REOPENED&sort=priority&order=desc')).data.items as Json[];
      for (const t of waiting) {
        const sug = (await call(sup, 'GET', `/tickets/${t.id}/suggestions`)).data.items as Json[];
        const best = sug.find((s) => s.canAssign);
        if (!best) continue;
        const r = await call(sup, 'POST', `/tickets/${t.id}/assign`, { technicianId: best.technician.id, version: t.version });
        if (r.status === 200) log('supervisor', `assigned ${t.ticketNo} -> ${best.technician.name}`);
      }

      // 3) technicians do the work
      for (const tech of techs) {
        const mine = (await call(tech.token, 'GET', '/tickets?status=ASSIGNED,IN_PROGRESS')).data.items as Json[];
        for (const t of mine) {
          const steps = (await call(tech.token, 'GET', `/tickets/${t.id}/steps`)).data.steps as Json[];
          for (const s of steps.filter((x) => x.status === 'IN_PROGRESS')) {
            if (!dueAt.has(s.id)) dueAt.set(s.id, Date.now());
            if (Date.now() >= (dueAt.get(s.id) as number)) {
              const r = await call(tech.token, 'POST', `/steps/${s.id}/complete`, {});
              if (r.status === 200) log(tech.name, `${t.ticketNo} done: "${s.title}" (est ${s.estimatedMinutes}m, actual ${r.data.step.actualMinutes}m)`);
              dueAt.delete(s.id);
            }
          }
          const running = steps.some((x) => x.status === 'IN_PROGRESS');
          const ready = steps.find((x) => x.status === 'READY');
          if (!running && ready) {
            const r = await call(tech.token, 'POST', `/steps/${ready.id}/start`);
            if (r.status === 200) {
              const factor = Math.random() < 0.3 ? 1.4 + Math.random() * 1.4 : 0.6 + Math.random() * 0.5; // 30% overrun
              dueAt.set(ready.id, Date.now() + (ready.estimatedMinutes * factor * 60_000) / scale);
              log(tech.name, `${t.ticketNo} started: "${ready.title}" (est ${ready.estimatedMinutes}m${factor > 1.2 ? ', will overrun' : ''})`);
            }
          } else if (!running && !ready && steps.length && steps.every((x) => x.status === 'DONE' || x.status === 'SKIPPED') && t.status === 'IN_PROGRESS') {
            const r = await call(tech.token, 'POST', `/tickets/${t.id}/request-verification`, {});
            if (r.status === 202) log(tech.name, `${t.ticketNo} requested speed verification`);
          }
        }
      }

      // 4) operator closes the loop with the customer
      const resolved = (await call(op, 'GET', '/tickets?status=RESOLVED')).data.items as Json[];
      for (const t of resolved) {
        if (!resolvedSeen.has(t.id)) resolvedSeen.set(t.id, Date.now() + 3000 + Math.random() * 6000);
        if (Date.now() < (resolvedSeen.get(t.id) as number)) continue;
        resolvedSeen.delete(t.id);
        if (Math.random() < 0.9) { await call(op, 'POST', `/tickets/${t.id}/confirm`, {}); log('operator', `${t.ticketNo} customer confirmed -> CLOSED`); }
        else { await call(op, 'POST', `/tickets/${t.id}/reopen`, { reason: 'Customer says the problem is back' }); log('operator', `${t.ticketNo} customer says still broken -> REOPENED`); }
      }
    } catch (e) {
      log('error', e instanceof Error ? e.message : String(e));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('system', 'demo finished');
}

main().catch((e) => { console.error(e); process.exit(1); });
