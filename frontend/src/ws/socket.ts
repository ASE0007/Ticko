import type { WsMessage } from '../api/types';
import { useUi } from '../store/ui';
import { applyEvent } from './events';

type Auth = { token: string } | { trackToken: string };

/**
 * WebSocket client with:
 *  - exponential back-off + jitter reconnect
 *  - `resume {lastSeq}` after a reconnect so missed events are replayed (no stale dashboard)
 *  - `onResync` callback when the server says the gap is too large (client refetches once)
 *  - heartbeat ping so half-open connections are noticed
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private lastSeq = 0;
  private attempts = 0;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private everConnected = false;

  constructor(
    private auth: Auth,
    private opts: { onResync?: () => void; onMessage?: (m: WsMessage) => void; onStatus?: (s: 'connecting' | 'live' | 'reconnecting' | 'offline') => void; url?: string; trackStatus?: boolean } = {},
  ) {}

  connect(): void {
    this.closed = false;
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(this.opts.url ?? `${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', ...this.auth }));
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 20_000);
    };
    ws.onmessage = (e) => {
      let msg: WsMessage;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (msg.type === 'system.hello') {
        const wasReconnect = this.everConnected;
        this.everConnected = true;
        this.attempts = 0;
        this.setStatus('live');
        if (wasReconnect && this.lastSeq > 0) ws.send(JSON.stringify({ type: 'resume', lastSeq: this.lastSeq }));
        else this.lastSeq = msg.payload?.seq ?? 0;
        if (msg.payload?.timeScale) useUi.getState().setTimeScale(msg.payload.timeScale);
        return;
      }
      if (msg.type === 'system.resync_required') {
        this.lastSeq = msg.payload?.currentSeq ?? 0;
        this.opts.onResync?.();
        return;
      }
      if (msg.seq > 0) this.lastSeq = Math.max(this.lastSeq, msg.seq);
      if (msg.type.startsWith('system.') || msg.type === 'pong') return;
      this.opts.onMessage ? this.opts.onMessage(msg) : applyEvent(msg);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.closed) return;
      if (ev.code === 4401 || ev.code === 4403) { this.setStatus('offline'); return; } // bad credentials: do not loop
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(): void {
    this.setStatus('reconnecting');
    const delay = Math.min(15_000, 500 * 2 ** this.attempts++) * (0.7 + Math.random() * 0.6);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  subscribe(room: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', room }));
  }
  unsubscribe(room: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'unsubscribe', room }));
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.setStatus('offline');
  }

  private setStatus(s: 'connecting' | 'live' | 'reconnecting' | 'offline') {
    this.opts.onStatus?.(s);
    if (this.opts.trackStatus !== false) useUi.getState().setConn(s);
  }
}
