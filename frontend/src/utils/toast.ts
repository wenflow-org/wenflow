import { reactive } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  closing: boolean;
}

const toasts = reactive<ToastItem[]>([]);
let nextId = 0;

const removeToast = (id: number) => {
  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
};

const addToast = (type: ToastType, message: string, duration = 3000) => {
  const id = ++nextId;
  const toast: ToastItem = { id, type, message, closing: false };
  toasts.push(toast);

  if (duration > 0) {
    setTimeout(() => {
      const t = toasts.find((item) => item.id === id);
      if (t) {
        t.closing = true;
        setTimeout(() => removeToast(id), 250);
      }
    }, duration);
  }

  return id;
};

export const toast = {
  success: (message: string, duration?: number) => addToast('success', message, duration),
  error: (message: string, duration?: number) => addToast('error', message, duration ?? 4000),
  warning: (message: string, duration?: number) => addToast('warning', message, duration),
  info: (message: string, duration?: number) => addToast('info', message, duration),
  close: (id: number) => {
    const t = toasts.find((item) => item.id === id);
    if (t) {
      t.closing = true;
      setTimeout(() => removeToast(id), 250);
    }
  },
  toasts
};
