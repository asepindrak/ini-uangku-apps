import { writable } from 'svelte/store';
import type { User, Family } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  family: Family | null;
  isAuthenticated: boolean;
}

const savedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('iniuangku_token') : null;
const savedUser = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('iniuangku_user') || 'null') : null;
const savedFamily = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('iniuangku_family') || 'null') : null;

export const auth = writable<AuthState>({
  token: savedToken,
  user: savedUser,
  family: savedFamily,
  isAuthenticated: !!savedToken && !!savedUser,
});

export function setAuth(token: string, user: User, family: Family) {
  auth.set({
    token,
    user,
    family,
    isAuthenticated: true,
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('iniuangku_token', token);
    localStorage.setItem('iniuangku_user', JSON.stringify(user));
    localStorage.setItem('iniuangku_family', JSON.stringify(family));
  }
}

export function updateAuthUser(partialUser: any) {
  auth.update((state) => {
    if (!state.user) return state;
    const updated = { ...state.user, ...partialUser };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('iniuangku_user', JSON.stringify(updated));
    }
    return { ...state, user: updated };
  });
}

export function clearAuth() {
  auth.set({
    token: null,
    user: null,
    family: null,
    isAuthenticated: false,
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('iniuangku_token');
    localStorage.removeItem('iniuangku_user');
    localStorage.removeItem('iniuangku_family');
  }
}
