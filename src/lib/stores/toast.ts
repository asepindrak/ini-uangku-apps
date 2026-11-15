import { writable } from 'svelte/store';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<ToastMessage[]>([]);

  function add(type: 'success' | 'error' | 'info' | 'warning', message: string, title?: string, duration = 3500) {
    const id = Math.random().toString(36).substring(2, 9);
    const item: ToastMessage = { id, type, title, message, duration };

    update((list) => [...list, item]);

    if (duration > 0) {
      setTimeout(() => {
        dismiss(id);
      }, duration);
    }
    return id;
  }

  function dismiss(id: string) {
    update((list) => list.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    success: (message: string, title?: string, duration?: number) => add('success', message, title, duration),
    error: (message: string, title?: string, duration?: number) => add('error', message, title, duration),
    info: (message: string, title?: string, duration?: number) => add('info', message, title, duration),
    warning: (message: string, title?: string, duration?: number) => add('warning', message, title, duration),
    dismiss,
    clear: () => update(() => []),
  };
}

export const toast = createToastStore();
