import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../lib/api';

interface AuthState {
  token: string | null;
  user: { id: string; username?: string; firstName?: string } | null;
  isAuthenticated: boolean;
  login: (username: string) => Promise<void>;
  loginWithTelegram: (initData: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: async (username: string) => {
        const { data } = await authApi.devLogin(username);
        localStorage.setItem('gt_token', data.token);
        set({ token: data.token, user: data.user, isAuthenticated: true });
      },

      loginWithTelegram: async (initData: string) => {
        const { data } = await authApi.telegramLogin(initData);
        localStorage.setItem('gt_token', data.token);
        set({ token: data.token, user: data.user, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem('gt_token');
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    { name: 'gt-auth' }
  )
);
