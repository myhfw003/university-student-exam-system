/* ==========================================================================
   知行测评 · 监考数据轮询适配器
   --------------------------------------------------------------------------
   设计文档 FR-ANT-04 要求监考视图以**批量聚合**方式更新（默认 2 秒一批），
   不做逐事件即时推送；NFR-PERF-08 要求刷新延迟 < 3 秒。

   后端接入 SignalR 后，只需把本 hook 内部的轮询换成 Hub 订阅，
   对外暴露的 `candidates` 语义不变。
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { proctorSnapshot, setCandidate } from "@exam/shared/mock/adminOps";
import type { ProctorCandidate } from "@exam/shared/domain/types";

/** 轮询间隔（毫秒）。 */
export const PROCTOR_POLL_MS = 2000;

/** 监考数据源。 */
export interface ProctorFeed {
  /** 当前快照。 */
  candidates: ProctorCandidate[];
  /** 是否正在刷新。 */
  refreshing: boolean;
  /** 最近一次刷新时间戳。 */
  updatedAt: number;
  /** 手动刷新。 */
  refresh: () => void;
}

/**
 * 订阅监考快照。
 *
 * @param sessionId 场次 ID；为空时不订阅。
 */
export function useProctorFeed(sessionId: string | undefined): ProctorFeed {
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    timerRef.current = setInterval(() => {
      setRefreshing(true);
      setTick((prev) => prev + 1);
    }, PROCTOR_POLL_MS);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId]);

  const candidates = useMemo(
    () => (sessionId ? proctorSnapshot(sessionId, tick) : []),
    [sessionId, tick],
  );

  useEffect(() => {
    setRefreshing(false);
    setUpdatedAt(Date.now());
  }, [tick]);

  // 教师处置后写入的考生状态优先于模拟快照。
  useEffect(() => {
    for (const candidate of candidates) {
      setCandidate(candidate);
    }
  }, [candidates]);

  return {
    candidates,
    refreshing,
    updatedAt,
    refresh: () => setTick((prev) => prev + 1),
  };
}
