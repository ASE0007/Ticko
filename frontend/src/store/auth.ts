import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../api/types';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'ticko-auth' },
  ),
);

export const isManager = (u: User | null) => u?.role === 'SUPERVISOR' || u?.role === 'ADMIN';
export const isStaff = (u: User | null) => !!u && u.role !== 'TECHNICIAN';
