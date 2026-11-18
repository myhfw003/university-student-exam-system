/* ==========================================================================
   知行测评 · 监考数据轮询适配器
   --------------------------------------------------------------------------
   设计文档 FR-ANT-04 要求监考视图以**批量聚合**方式更新（默认 2 秒一批），
   不做逐事件即时推送；NFR-PERF-08 要求刷新延迟 < 3 秒。

   后端 `GET /exam-sessions/{id}/monitoring` 返回
   `{ examSessionId, serverTime, candidates[] }`；本 hook 负责把后端的
   状态词表（in_progress / auto_submitted / force_submitted / abandoned）
   映射成监考视图的语义（answering / submitted / forced_submitted / disconnected）。

   后端接入 SignalR 后，只需把轮询换成 Hub 订阅，对外语义不变。
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { ENDPOINTS, httpClient, isBackendEnabled } from "@exam/shared/api";
import { proctorSnapshot, setCandidate } from "@exam/shared/mock/adminOps";
import type { CandidateStatus, ProctorCandidate } from "@exam/shared/domain/types";

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

/** 后端监考快照里的一名考生（ExamCandidateStatusDto）。 */
interface CandidateDto {
  attemptId?: string | number;
  userId?: string | number;
  displayName?: string;
  username?: string;
  status?: string;
  focusLossCount?: number;
  disconnectCount?: number;
  lastHeartbeatAt?: string | null;
  offline?: boolean;
  answeredCount?: number;
  totalCount?: number;
}

/** 后端监考快照（ExamStatusBatchDto）。 */
interface MonitoringDto {
  examSessionId?: string | number;
  serverTime?: string;
  candidates?: CandidateDto[];
}

/** 后端 AttemptStatus 存储值 → 监考视图状态。 */
const STATUS_MAP: Record<string, CandidateStatus> = {
  not_started: "not_started",
  in_progress: "answering",
  submitted: "submitted",
  auto_submitted: "submitted",
  force_submitted: "forced_submitted",
  abandoned: "disconnected",
};

function toCandidate(sessionId: string, dto: CandidateDto): ProctorCandidate {
  const raw = dto.status ?? "not_started";
  let status = STATUS_MAP[raw] ?? "not_started";
  // 仍在作答但心跳超时：监考视图按「断连中」呈现，与模拟快照语义一致。
  if (dto.offline && raw === "in_progress") status = "disconnected";

  const candidate: ProctorCandidate = {
    sessionId,
    studentId: String(dto.userId ?? dto.attemptId ?? ""),
    status,
    focusLossCount: dto.focusLossCount ?? 0,
    disconnectCount: dto.disconnectCount ?? 0,
    lastHeartbeatAt: dto.lastHeartbeatAt ?? null,
    answeredCount: dto.answeredCount ?? 0,
    totalCount: dto.totalCount ?? 0,
    submittedAt: null,
    forcedReason: null,
  };

  // 处置是按作答下发的：没有 attemptId 就不知道该往哪次作答上写。
  if (dto.attemptId !== undefined && dto.attemptId !== null) {
    candidate.attemptId = String(dto.attemptId);
  }
  if (dto.displayName) candidate.displayName = dto.displayName;
  if (dto.username) candidate.username = dto.username;
  return candidate;
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

  // 数据源切到后端时，轮询真实的考生状态；否则用确定性模拟快照。
  const [remote, setRemote] = useState<ProctorCandidate[] | null>(null);
  useEffect(() => {
    if (!sessionId || !isBackendEnabled()) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await httpClient.get<MonitoringDto>(ENDPOINTS.delivery.monitoring(sessionId));
        if (cancelled) return;
        setRemote((res.candidates ?? []).map((candidate) => toCandidate(sessionId, candidate)));
      } catch {
        // 拉取失败时保留上一份快照，监考视图不闪空。
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), PROCTOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  const candidates = useMemo(
    () => (sessionId ? (remote ?? proctorSnapshot(sessionId, tick)) : []),
    [sessionId, tick, remote],
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
