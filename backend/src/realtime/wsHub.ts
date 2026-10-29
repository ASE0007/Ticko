import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../repositories/prisma';
import { resolveUser, type AuthUser } from '../middleware/auth';
import { WS_REPLAY_BUFFER_SIZE } from '../config/constants';
import { clock } from '../utils/clock';
import { logger } from '../utils/logger';
import { bus, rooms, type DomainEvent } from './eventBus';

interface Client {
  id: string;
  ws: WebSocket;
  user: AuthUser | null;
  trackTicketId: string | null;
  rooms: Set<string>;
  alive: boolean;
  authTimer: NodeJS.Timeout | null;
}
interface Buffered extends DomainEvent { seq: number }

const MAX_SOCKETS_PER_USER = 5;

/**
 * WebSocket hub (mandatory real-time channel, FR-37..40).
 *  - first message must be {type:"auth"}; unauthenticated sockets are dropped after 5 s
 *  - rooms route events: staff / tech:{id} / ticket:{id} / track:{ticketId}
 *  - every event has a global `seq`; a ring buffer lets clients `resume` after a reconnect
 *  - heartbeat ping/pong terminates dead connections
 */
export class WsHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<Client>();
  private seq = 0;
  private buffer: Buffered[] = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  private listener = (e: DomainEvent) => this.dispatch(e);

  attach(server: http.Server, path = '/ws'): void {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== path) return void socket.destroy();
      this.wss?.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    bus.on('event', this.listener);
    this.heartbeat = setInterval(() => this.beat(), 25_000);
    this.heartbeat.unref();
  }

  async close(): Promise<void> {
    bus.off('event', this.listener);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
    this.clients.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }

  clientCount(): number {
    return [...this.clients].filter((c) => c.user || c.trackTicketId).length;
  }

  currentSeq(): number {
    return this.seq;
  }

  private onConnection(ws: WebSocket): void {
    const c: Client = { id: randomUUID(), ws, user: null, trackTicketId: null, rooms: new Set(), alive: true, authTimer: null };
    this.clients.add(c);
    c.authTimer = setTimeout(() => { if (!c.user && !c.trackTicketId) ws.close(4401, 'auth timeout'); }, 5000);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => void this.onMessage(c, raw.toString()).catch((err) => { logger.warn({ err }, 'ws message error'); this.send(c, 'system.error', { message: 'Bad request' }); }));
    ws.on('close', () => {
      if (c.authTimer) clearTimeout(c.authTimer);
      this.clients.delete(c);
      if (c.user) this.schedulePresence();
    });
    ws.on('error', () => ws.terminate());
  }

  private async onMessage(c: Client, raw: string): Promise<void> {
    let msg: { type?: string; token?: string; trackToken?: string; room?: string; lastSeq?: number };
    try { msg = JSON.parse(raw); } catch { return this.send(c, 'system.error', { message: 'Invalid JSON' }); }

    if (msg.type === 'ping') return this.send(c, 'pong', { ts: new Date().toISOString() });

    if (msg.type === 'auth') {
      if (c.user || c.trackTicketId) return;
      if (msg.trackToken) {
        const t = await prisma.ticket.findUnique({ where: { trackToken: msg.trackToken }, select: { id: true, number: true } });
        if (!t) return void c.ws.close(4403, 'invalid tracking token');
        c.trackTicketId = t.id;
        c.rooms.add(rooms.track(t.id));
        this.clearAuthTimer(c);
        return this.send(c, 'system.hello', { seq: this.seq, ticketNo: `TX-${t.number}`, timeScale: clock.scale });
      }
      let user: AuthUser;
      try { user = await resolveUser(msg.token ?? ''); } catch { return void c.ws.close(4401, 'invalid token'); }
      c.user = user;
      if (user.role === 'TECHNICIAN') { if (user.technicianId) c.rooms.add(rooms.tech(user.technicianId)); }
      else c.rooms.add(rooms.staff);
      this.clearAuthTimer(c);
      this.enforceSocketLimit(user.id);
      this.send(c, 'system.hello', { seq: this.seq, user: { id: user.id, name: user.name, role: user.role }, rooms: [...c.rooms], timeScale: clock.scale });
      this.schedulePresence();
      return;
    }

    if (!c.user && !c.trackTicketId) return void c.ws.close(4401, 'auth required');

    if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
      const room = msg.room ?? '';
      if (!/^ticket:[0-9a-f-]{36}$/.test(room) || !c.user) return this.send(c, 'system.error', { message: 'Room not allowed' });
      if (msg.type === 'unsubscribe') { c.rooms.delete(room); return; }
      if (c.user.role === 'TECHNICIAN') {
        const tid = c.user.technicianId ?? '';
        const ok = await prisma.ticket.count({ where: { id: room.slice(7), OR: [{ technicianId: tid }, { steps: { some: { assigneeId: tid } } }, { assignments: { some: { technicianId: tid, releasedAt: null } } }] } });
        if (!ok) return this.send(c, 'system.error', { message: 'Not your ticket' });
      }
      c.rooms.add(room);
      return this.send(c, 'system.subscribed', { room });
    }

    if (msg.type === 'resume') {
      const last = Number(msg.lastSeq ?? 0);
      const oldest = this.buffer[0]?.seq ?? this.seq + 1;
      if (last > this.seq || (last < oldest - 1 && this.seq > 0 && last < this.seq)) {
        return this.send(c, 'system.resync_required', { currentSeq: this.seq });
      }
      let replayed = 0;
      for (const e of this.buffer) if (e.seq > last && this.deliverTo(c, e)) replayed++;
      return this.send(c, 'system.resumed', { replayed, seq: this.seq });
    }
  }

  private dispatch(event: DomainEvent): void {
    const buffered: Buffered = { ...event, seq: ++this.seq };
    this.buffer.push(buffered);
    if (this.buffer.length > WS_REPLAY_BUFFER_SIZE) this.buffer.shift();
    for (const c of this.clients) this.deliverTo(c, buffered);
  }

  /** At most ONE copy of an event per client, even if it matches several rooms. */
  private deliverTo(c: Client, e: Buffered): boolean {
    if (c.ws.readyState !== WebSocket.OPEN) return false;
    for (const d of e.deliveries) {
      if (c.rooms.has(d.room)) {
        c.ws.send(JSON.stringify({ seq: e.seq, type: e.type, ts: e.ts, room: d.room, payload: d.payload }));
        return true;
      }
    }
    return false;
  }

  private send(c: Client, type: string, payload: unknown): void {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ seq: 0, type, ts: new Date().toISOString(), payload }));
  }

  private clearAuthTimer(c: Client) {
    if (c.authTimer) clearTimeout(c.authTimer);
    c.authTimer = null;
  }

  private enforceSocketLimit(userId: string): void {
    const mine = [...this.clients].filter((x) => x.user?.id === userId);
    while (mine.length > MAX_SOCKETS_PER_USER) mine.shift()?.ws.close(4409, 'too many connections');
  }

  private beat(): void {
    for (const c of this.clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }

  /** Presence (FR-40), debounced so a burst of connects sends one event. */
  private schedulePresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const seen = new Map<string, { id: string; name: string; role: string }>();
      for (const c of this.clients) if (c.user) seen.set(c.user.id, { id: c.user.id, name: c.user.name, role: c.user.role });
      bus.publish('presence.updated', [{ room: rooms.staff, payload: { online: [...seen.values()] } }]);
    }, 400);
    this.presenceTimer.unref();
  }
}

export const hub = new WsHub();
