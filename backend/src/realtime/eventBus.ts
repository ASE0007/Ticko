import { EventEmitter } from 'node:events';

export interface Delivery {
  room: string;
  payload: unknown;
}

export interface DomainEvent {
  type: string;
  ts: string;
  deliveries: Delivery[];
}

/**
 * In-process event bus. Services publish domain events AFTER their DB transaction
 * committed; the WebSocket hub is the only subscriber that talks to clients.
 * (Horizontal scaling later = swap this for Redis Pub/Sub, same interface.)
 */
class EventBus extends EventEmitter {
  publish(type: string, deliveries: Delivery[]): void {
    if (deliveries.length === 0) return;
    const event: DomainEvent = { type, ts: new Date().toISOString(), deliveries };
    this.emit('event', event);
  }
}

export const bus = new EventBus();
bus.setMaxListeners(50);

export const rooms = {
  staff: 'staff',
  tech: (technicianId: string) => `tech:${technicianId}`,
  ticket: (ticketId: string) => `ticket:${ticketId}`,
  track: (ticketId: string) => `track:${ticketId}`,
};
