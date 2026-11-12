/* ==========================================================================
   知行测评 · 命令式提示条
   --------------------------------------------------------------------------
   写操作的成功 / 失败反馈需要命令式触发（不依赖组件树），
   因此用一个轻量 store 承载提示条队列。

   生命周期对齐原型：展示 2600ms → 淡出 240ms → 移除。
   ========================================================================== */

import { create } from "zustand";
import type { ToastTone } from "./Toast";

/** 一条提示。 */
export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

/** 展示时长（毫秒）。 */
const DISPLAY_MS = 2600;

/** 淡出时长（毫秒）。 */
const FADE_MS = 240;

interface ToastState {
  /** 当前的提示条。 */
  toasts: ToastItem[];
  /** 推入一条提示。 */
  push: (message: string, tone?: ToastTone) => void;
  /** 移除一条提示。 */
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (message, tone = "info") => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, message, tone }] });

    setTimeout(() => {
      // 先淡出，再移除。
      set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, tone: t.tone } : t)) });
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      }, FADE_MS);
    }, DISPLAY_MS);
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** 便捷方法：在任意位置触发提示条。 */
export const toast = {
  ok: (message: string) => useToastStore.getState().push(message, "ok"),
  error: (message: string) => useToastStore.getState().push(message, "error"),
  info: (message: string) => useToastStore.getState().push(message, "info"),
};
