import { reactive } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastRuntime {
  remaining: number;
  startedAt: number;
  paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const MAX_VISIBLE_TOASTS = 3;
const DEDUPE_WINDOW_MS = 1200;
const toasts = reactive<ToastItem[]>([]);
const runtimes = new Map<number, ToastRuntime>();
const recentToasts = new Map<string, { id: number; shownAt: number }>();
let nextId = 0;

const removeToast = (id: number) => {
  const runtime = runtimes.get(id);
  if (runtime?.timer) clearTimeout(runtime.timer);
  runtimes.delete(id);
  recentToasts.forEach((recent, key) => {
    if (recent.id === id) recentToasts.delete(key);
  });

  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
};

const scheduleToast = (id: number) => {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.paused || runtime.remaining <= 0) return;

  runtime.startedAt = Date.now();
  runtime.timer = setTimeout(() => removeToast(id), runtime.remaining);
};

const resetToastTimer = (id: number, duration: number) => {
  let runtime = runtimes.get(id);

  if (runtime?.timer) clearTimeout(runtime.timer);
  if (duration <= 0) {
    runtimes.delete(id);
    return;
  }

  if (!runtime) {
    runtime = { remaining: duration, startedAt: Date.now(), paused: false };
    runtimes.set(id, runtime);
  }
  runtime.timer = undefined;
  runtime.remaining = duration;
  scheduleToast(id);
};

const addToast = (type: ToastType, message: string, duration = 3000) => {
  const now = Date.now();
  const dedupeKey = `${type}\u0000${message}`;

  // 同文案仍在屏上 → 只续时，不再叠第二张（2026-11-02 走查）。
  // 原实现只在 1.2s 窗口内去重，用户反复点同一个按钮（如局域网 http 下复制连点）
  // 会堆起两三张一模一样的卡，右上角一片阴影；同一条信息重复出现本来也不该占位。
  const onScreen = toasts.find((item) => item.type === type && item.message === message);
  if (onScreen) {
    recentToasts.set(dedupeKey, { id: onScreen.id, shownAt: now });
    resetToastTimer(onScreen.id, duration);
    return onScreen.id;
  }

  const recent = recentToasts.get(dedupeKey);
  const duplicate = recent && now - recent.shownAt <= DEDUPE_WINDOW_MS
    ? toasts.find((item) => item.id === recent.id)
    : undefined;

  if (duplicate) {
    recentToasts.set(dedupeKey, { id: duplicate.id, shownAt: now });
    resetToastTimer(duplicate.id, duration);
    return duplicate.id;
  }

  if (toasts.length >= MAX_VISIBLE_TOASTS) {
    removeToast(toasts[0].id);
  }

  const id = ++nextId;
  toasts.push({ id, type, message });
  recentToasts.set(dedupeKey, { id, shownAt: now });

  if (duration > 0) {
    runtimes.set(id, {
      remaining: duration,
      startedAt: now,
      paused: false
    });
    scheduleToast(id);
  }

  return id;
};

const pauseToast = (id: number) => {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.paused) return;

  runtime.paused = true;
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = undefined;
    runtime.remaining = Math.max(0, runtime.remaining - (Date.now() - runtime.startedAt));
  }
};

const resumeToast = (id: number) => {
  const runtime = runtimes.get(id);
  if (!runtime || !runtime.paused) return;

  runtime.paused = false;
  if (runtime.remaining <= 0) {
    removeToast(id);
    return;
  }
  scheduleToast(id);
};

export const toast = {
  success: (message: string, duration?: number) => addToast('success', message, duration),
  error: (message: string, duration?: number) => addToast('error', message, duration ?? 4000),
  warning: (message: string, duration?: number) => addToast('warning', message, duration),
  info: (message: string, duration?: number) => addToast('info', message, duration),
  close: removeToast,
  pause: pauseToast,
  resume: resumeToast,
  toasts
};
