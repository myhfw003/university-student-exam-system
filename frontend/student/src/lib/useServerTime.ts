/* ==========================================================================
   知行测评 · 服务端权威时钟
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §5。

   原型用本地倒计时，改系统时间即可绕过。本实现：
     GET /api/v1/system/time → { serverTime, monotonicTime }
     多次采样（间隔 1s，取 3 次）→ offset = median(serverTime - clientTime)
     剩余秒数 = (deadlineAt - (clientNow + offset)) / 1000

   - 每 60 秒重新同步一次；切换考试时立即同步。
   - 偏移突变超过 5 秒 → 提示「检测到本机时间异常，已以服务器时间为准」。
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";

/** 时钟采样接口。 */
export interface ServerTimeSource {
  /** 拉取服务端时间。 */
  fetch: () => Promise<number>;
}

/** 采样次数。 */
const SAMPLE_COUNT = 3;

/** 采样间隔（毫秒）。 */
const SAMPLE_INTERVAL_MS = 1000;

/** 重新同步周期（毫秒）。 */
const RESYNC_INTERVAL_MS = 60_000;

/** 偏移突变告警阈值（毫秒）。 */
const DRIFT_THRESHOLD_MS = 5_000;

/** 中位数。 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** 同步结果。 */
export interface ServerTimeState {
  /** 客户端与服务端的时钟偏移（毫秒，服务端 - 客户端）。 */
  offsetMs: number;
  /** 当前服务端时间（毫秒时间戳）。 */
  serverNow: () => number;
  /** 是否检测到时钟异常。 */
  driftDetected: boolean;
  /** 是否已完成首次同步。 */
  synced: boolean;
  /** 立即重新同步。 */
  resync: () => Promise<void>;
}

/**
 * 服务端时钟 Hook。
 */
export function useServerTime(source: ServerTimeSource, enabled = true): ServerTimeState {
  const [offsetMs, setOffsetMs] = useState(0);
  const [synced, setSynced] = useState(false);
  const [driftDetected, setDriftDetected] = useState(false);

  const offsetRef = useRef(0);
  const driftRef = useRef(false);

  const resync = useCallback(async () => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
      }
      try {
        const serverTime = await source.fetch();
        samples.push(serverTime - Date.now());
      } catch {
        // 单次采样失败不阻断整轮同步。
      }
    }
    if (samples.length === 0) return;

    const next = median(samples);
    // 偏移突变超过阈值 → 认为是本机时间被改动。
    if (offsetRef.current !== 0 && Math.abs(next - offsetRef.current) > DRIFT_THRESHOLD_MS) {
      driftRef.current = true;
      setDriftDetected(true);
    }
    offsetRef.current = next;
    setOffsetMs(next);
    setSynced(true);
  }, [source]);

  useEffect(() => {
    if (!enabled) return;
    void resync();
    const timer = setInterval(() => {
      void resync();
    }, RESYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, resync]);

  const serverNow = useCallback(() => Date.now() + offsetMs, [offsetMs]);

  return { offsetMs, serverNow, driftDetected, synced, resync };
}
