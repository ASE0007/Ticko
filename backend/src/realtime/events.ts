import { bus, rooms, type Delivery } from './eventBus';
import { toPublicTicketDTO, type TicketDTO, type TicketRow } from '../services/views';

/** Fan a ticket-level event out to every audience with the right level of detail. */
export function emitTicketEvent(
  type: string,
  ticket: TicketDTO,
  row: TicketRow,
  extra: Record<string, unknown> = {},
  opts: { includeTrack?: boolean } = { includeTrack: true },
): void {
  const full = { ticket, ...extra };
  const deliveries: Delivery[] = [
    { room: rooms.staff, payload: full },
    { room: rooms.ticket(ticket.id), payload: full },
  ];
  if (ticket.technician) deliveries.push({ room: rooms.tech(ticket.technician.id), payload: full });
  if (opts.includeTrack !== false) {
    deliveries.push({ room: rooms.track(ticket.id), payload: { ticket: toPublicTicketDTO(row), type } });
  }
  bus.publish(type, deliveries);
}

export function emitToStaffAndTicket(type: string, ticketId: string | null, payload: unknown): void {
  const deliveries: Delivery[] = [{ room: rooms.staff, payload }];
  if (ticketId) deliveries.push({ room: rooms.ticket(ticketId), payload });
  bus.publish(type, deliveries);
}
