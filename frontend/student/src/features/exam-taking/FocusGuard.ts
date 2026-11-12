/* ==========================================================================
   知行测评 · 防作弊焦点采集
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §6.1–6.2。

   采集的事件与是否计入切屏：
     window.blur              → 是
     visibilitychange hidden  → 是
     fullscreenchange（退出） → 是（仅当要求全屏）
     copy / paste / contextmenu → 否（仅记录）

   关键实现约束：
   1. blur 与 visibilitychange 在切标签页时**会同时触发**，会造成重复计数。
      对策：合并到 500ms 窗口内去重（同一时间窗内的同类事件只计一次）。
   2. 客户端只上报不做判定——计数由服务端确认，避免客户端被篡改。
   ========================================================================== */

import { useCallback, useEffect, useRef } from "react";
import { isFocusLoss, type FocusEventType } from "@exam/shared/domain/attempt";

/** 去重窗口（毫秒）。 */
const DEDUPE_WINDOW_MS = 500;

/** 焦点事件上报回调。 */
export type FocusEventHandler = (event: {
  type: FocusEventType;
  clientAt: string;
  /** 该事件是否计入切屏计数。 */
  countsAsFocusLoss: boolean;
  meta?: Record<string, unknown>;
}) => void;

/** FocusGuard 配置。 */
export interface FocusGuardOptions {
  /** 是否启用采集。 */
  enabled: boolean;
  /** 是否要求全屏（退出全屏计入切屏）。 */
  requireFullscreen?: boolean;
  /** 事件上报回调。 */
  onEvent: FocusEventHandler;
}

/**
 * 焦点采集 Hook。
 *
 * 返回一个 ref 绑到 window 上用于注册监听；组件卸载时自动清理。
 */
export function useFocusGuard(options: FocusGuardOptions): void {
  const { enabled, requireFullscreen = false, onEvent } = options;

  // 用 ref 持有回调，避免因回调变化反复重挂监听。
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  // 记录上一次切屏类事件的时间戳，用于 500ms 窗口去重。
  const lastFocusLossAt = useRef(0);

  const emit = useCallback((type: FocusEventType, meta?: Record<string, unknown>) => {
    const countsAsFocusLoss = isFocusLoss(type);
    const now = Date.now();

    if (countsAsFocusLoss) {
      // 500ms 窗口内的同类切屏事件只计一次。
      if (now - lastFocusLossAt.current < DEDUPE_WINDOW_MS) {
        return;
      }
      lastFocusLossAt.current = now;
    }

    handlerRef.current({
      type,
      clientAt: new Date(now).toISOString(),
      countsAsFocusLoss,
      ...(meta ? { meta } : {}),
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onBlur = () => emit("window_blur");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        emit("page_hidden");
      }
    };
    const onFullscreen = () => {
      if (!requireFullscreen) return;
      if (document.fullscreenElement === null) {
        emit("fullscreen_exit");
      }
    };
    const onCopy = () => emit("copy_attempt");
    const onPaste = () => emit("paste_attempt");
    const onContextMenu = () => emit("context_menu");

    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [enabled, requireFullscreen, emit]);
}
