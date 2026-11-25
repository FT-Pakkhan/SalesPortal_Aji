import { create } from 'zustand';
import type { PortalUser } from '@/types';

interface AuthState {
  user: PortalUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: PortalUser, token: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
  updateUser: (changes: Partial<PortalUser>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  login: (user, token) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as PortalUser;
        set({ user, token, isAuthenticated: true });
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
      }
    }
  },

  // Keep the stored user in step after the profile is edited (shell bar shows displayName)
  updateUser: (changes) => {
    set((state) => {
      if (!state.user) return state;
      const user = { ...state.user, ...changes };
      localStorage.setItem('user', JSON.stringify(user));
      return { user };
    });
  },
}));
