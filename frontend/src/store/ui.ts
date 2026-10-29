import { create } from 'zustand';

export type ConnStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
export interface Toast { id: number; kind: 'info' | 'ok' | 'warn' | 'danger'; title: string; text?: string; ticketId?: string }

interface UiState {
  conn: ConnStatus;
  timeScale: number;
  theme: 'dark' | 'light';
  toasts: Toast[];
  newTicketOpen: boolean;
  setConn: (c: ConnStatus) => void;
  setTimeScale: (n: number) => void;
  toggleTheme: () => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  openNewTicket: (open: boolean) => void;
}

let nextId = 1;
const savedTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('ticko-theme')) as 'dark' | 'light' | null;

export const useUi = create<UiState>((set, get) => ({
  conn: 'offline',
  timeScale: 1,
  theme: savedTheme ?? 'dark',
  toasts: [],
  newTicketOpen: false,
  setConn: (conn) => set({ conn }),
  setTimeScale: (timeScale) => set({ timeScale }),
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ticko-theme', theme); } catch { /* storage may be unavailable */ }
    set({ theme });
  },
  toast: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] })); // keep the stack short
    setTimeout(() => get().dismiss(id), t.kind === 'danger' ? 9000 : 5500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  openNewTicket: (newTicketOpen) => set({ newTicketOpen }),
}));
