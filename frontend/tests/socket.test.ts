import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../src/ws/socket';
import { useUi } from '../src/store/ui';

class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  serverSend(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }); }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

beforeEach(() => { vi.useFakeTimers(); FakeWS.instances = []; (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS; });
afterEach(() => vi.useRealTimers());

const hello = (seq: number) => ({ seq: 0, type: 'system.hello', ts: '', payload: { seq, timeScale: 60 } });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('RealtimeClient', () => {
  it('authenticates on open and reports live after hello', async () => {
    const c = new RealtimeClient({ token: 'abc' }, { onMessage: () => undefined });
    c.connect(); await flush();
    const ws = FakeWS.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'abc' });
    expect(useUi.getState().conn).toBe('connecting');
    ws.serverSend(hello(10));
    expect(useUi.getState().conn).toBe('live');
    expect(useUi.getState().timeScale).toBe(60);
    c.close();
  });

  it('reconnects with back-off and asks the server to RESUME from the last seen seq', async () => {
    const got: string[] = [];
    const c = new RealtimeClient({ token: 'abc' }, { onMessage: (m) => got.push(m.type) });
    c.connect(); await flush();
    FakeWS.instances[0]!.serverSend(hello(10));
    FakeWS.instances[0]!.serverSend({ seq: 11, type: 'ticket.created', ts: '', payload: {} });
    FakeWS.instances[0]!.serverSend({ seq: 12, type: 'ticket.updated', ts: '', payload: {} });
    FakeWS.instances[0]!.serverClose();
    expect(useUi.getState().conn).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1]!.serverSend(hello(40));
    expect(JSON.parse(FakeWS.instances[1]!.sent.at(-1)!)).toEqual({ type: 'resume', lastSeq: 12 });
    expect(got).toEqual(['ticket.created', 'ticket.updated']);
    c.close();
  });

  it('triggers a REST resync when the server cannot replay the gap', async () => {
    const onResync = vi.fn();
    const c = new RealtimeClient({ token: 'abc' }, { onMessage: () => undefined, onResync });
    c.connect(); await flush();
    FakeWS.instances[0]!.serverSend({ seq: 0, type: 'system.resync_required', ts: '', payload: { currentSeq: 999 } });
    expect(onResync).toHaveBeenCalledOnce();
    c.close();
  });

  it('does not loop when credentials are rejected (4401)', async () => {
    const c = new RealtimeClient({ token: 'bad' }, { onMessage: () => undefined });
    c.connect(); await flush();
    FakeWS.instances[0]!.serverClose(4401);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(useUi.getState().conn).toBe('offline');
  });
});
