import { writable } from 'svelte/store';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

interface DialogState extends ConfirmDialogOptions {
  isOpen: boolean;
  resolve?: (value: boolean) => void;
}

function createConfirmStore() {
  const { subscribe, update, set } = writable<DialogState>({
    isOpen: false,
    title: '',
    message: '',
  });

  function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        ...options,
        confirmText: options.confirmText || 'Konfirmasi',
        cancelText: options.cancelText || 'Batal',
        isDestructive: options.isDestructive ?? false,
        resolve,
      });
    });
  }

  function handleAction(result: boolean) {
    update((state) => {
      if (state.resolve) state.resolve(result);
      return { ...state, isOpen: false, resolve: undefined };
    });
  }

  return {
    subscribe,
    confirm,
    accept: () => handleAction(true),
    cancel: () => handleAction(false),
  };
}

export const confirmDialog = createConfirmStore();
