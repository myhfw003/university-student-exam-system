/* ==========================================================================
   知行测评 · 考试会话编排（HTTP 模式）
   --------------------------------------------------------------------------
   走真实后端的一支。与 mock 模式的差别集中在四处：

   1. **卷面来自服务端**：选项已按该考生置换过顺序，每个选项的键是原题键；
      前端按位置重新编号成 A/B/C，并记下「显示字母 → 原题键」。
   2. **倒计时以服务端截止时间为准**：`deadlineAt` 由服务端下发，本机改时间无效。
   3. **切屏计数以服务端为准**：客户端只上报，计数与强制交卷都由服务端裁决。
   4. **交卷走服务端**：判分、待阅任务、审计都在服务端完成。

   上行时显示字母要换算成原题键，否则梅花卷会整卷判错——
   换算发生在传输层（`lib/transports.ts`），这里只负责把换算表交给它。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@exam/shared";
import type { AnswerPayload } from "@exam/shared/domain/attempt";
import type { AttemptStatus, AttemptSurface } from "@exam/shared/domain/attempt";
import type { ExamPaper, PaperMode, Question } from "@exam/shared/domain/types";
import { buildPaperFromSurface } from "@exam/shared/engine/paper";
import {
  apiBaseUrl,
  buildOptionKeyMap,
  ENDPOINTS,
  getAccessToken,
  heartbeatAttempt,
  HttpError,
  listMyAttempts,
  loadExamSession,
  reportFocusEvents,
  startExamAttempt,
  submitAttempt,
  type ExamSessionDetail,
  type OptionKeyMap,
} from "@exam/shared/api";
import { clearDraft } from "@/stores/draftQueue";
import { SyncEngine } from "@/lib/syncEngine";
import { HttpAnswerTransport } from "@/lib/transports";
import { createHttpServerTimeSource } from "@/lib/serverTimeSource";
import { useServerTime } from "@/lib/useServerTime";
import { useClockDriftNotice } from "./useClockDriftNotice";
import { useStudentStore } from "@/stores/studentStore";
import { countAnswered, useExamSessionStore, type ExamResponses } from "@/stores/examSessionStore";
import { useFocusGuard } from "./FocusGuard";
import type { ExamSessionController, SessionBlockReason } from "./examSessionTypes";

/** 会话是否已结束（已交卷、超时被清理都算）。 */
function isFinished(status: AttemptStatus): boolean {
  return (
    status === "submitted" ||
    status === "auto_submitted" ||
    status === "force_submitted" ||
    status === "abandoned"
  );
}

/** 后端卷型规则 → 前端卷型。 */
function toPaperMode(rule: string): PaperMode {
  if (rule === "small_plum") return "small";
  if (rule === "large_plum") return "large";
  return "standard";
}

/** 响应 → 载荷。 */
function toPayload(response: ExamResponses[string] | undefined): AnswerPayload {
  if (!response) return {};
  const payload: AnswerPayload = {};
  if (response.choice) payload.selectedOptionKeys = response.choice;
  if (response.text !== undefined) payload.text = response.text ?? null;
  if (response.steps) {
    payload.steps = Object.entries(response.steps).map(([stepCode, text]) => ({
      stepCode,
      text: text ?? "",
    }));
  }
  return payload;
}

/**
 * HTTP 模式的考试会话控制器。
 *
 * @param sessionId 后端考试场次 ID。
 * @param enabled 是否启用；mock 模式下关掉，避免两套实现同时动会话状态。
 */
export function useRemoteExamSession(sessionId: string, enabled = true): ExamSessionController {
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);

  const session = useExamSessionStore();

  const [detail, setDetail] = useState<ExamSessionDetail | null>(null);
  const [surface, setSurface] = useState<AttemptSurface | null>(null);
  const [blocked, setBlocked] = useState<SessionBlockReason>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submitReason, setSubmitReason] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [focusLossCount, setFocusLossCount] = useState(0);

  const engineRef = useRef<SyncEngine | null>(null);
  const surfaceRef = useRef<AttemptSurface | null>(null);
  const keyMapRef = useRef<OptionKeyMap>({});

  /* ------------------------------------------------------ 载入与开考 */

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await loadExamSession(sessionId);
        if (cancelled) return;
        setDetail(loaded);

        // 场次已关闭：能交过卷就显示「已交卷」，否则显示「已结束」。
        if (loaded.status === "closed" || loaded.status === "cancelled") {
          const attempts = await listMyAttempts().catch(() => []);
          const done = attempts.find(
            (a) => a.examSessionId === sessionId && isFinished(a.status),
          );
          if (cancelled) return;
          if (done) {
            setSubmittedAt(done.submittedAt);
            setBlocked("already_submitted");
          } else {
            setBlocked("ended");
          }
          return;
        }

        // 开始（或续上）作答：服务端幂等，刷新后重进即可续上。
        const started = await startExamAttempt(sessionId);
        if (cancelled) return;
        surfaceRef.current = started;
        keyMapRef.current = buildOptionKeyMap(started.questions);
        setSurface(started);
        setBlocked(isFinished(started.status) ? "already_submitted" : null);
      } catch (error) {
        if (cancelled) return;
        // 进不去场次：可能是已交卷（不允许重考）、不在名单内或场次未开放。
        const attempts = await listMyAttempts().catch(() => []);
        const done = attempts.find(
          (a) => a.examSessionId === sessionId && isFinished(a.status),
        );
        if (cancelled) return;
        if (done) {
          setSubmittedAt(done.submittedAt);
          setBlocked("already_submitted");
          return;
        }
        const status = error instanceof HttpError ? error.status : undefined;
        setBlocked(status === 422 ? "ended" : "not_found");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId]);

  /* ---------------------------------------------------------------- 卷面 */

  const mode = useMemo(() => toPaperMode(detail?.variantRule ?? "standard"), [detail]);

  const paper = useMemo(() => {
    if (!surface) return null;
    return buildPaperFromSurface(surface, { examId: sessionId, studentId, mode });
  }, [surface, sessionId, studentId, mode]);

  // 答题页要用的「试卷」对象：HTTP 模式下由场次详情拼出来。
  const exam = useMemo<ExamPaper | null>(() => {
    if (!detail) return null;
    return {
      id: detail.id,
      name: detail.name,
      batch: "",
      tags: [],
      durationMin: detail.durationMinutes,
      totalScore: 0,
      passScore: 0,
      openAt: detail.openAt,
      closeAt: detail.closeAt,
      status:
        detail.status === "in_progress" ? "ongoing" : detail.status === "scheduled" ? "draft" : "ended",
      published: true,
      // 重考由服务端裁决（允许重考时重新进入会开出新的一次作答）。
      allowRetake: false,
      publishAnswer: "after_close",
      scope: [],
      questionIds: [],
      items: [],
      orderRule: "type",
      plum: { mode },
      note: detail.note,
    };
  }, [detail, mode]);

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const item of paper?.items ?? []) {
      if (item.question) map.set(item.qid, item.question);
    }
    return map;
  }, [paper]);

  /* ------------------------------------------------------- 会话初始化 */

  useEffect(() => {
    if (!enabled || !surface || !detail) return;

    const qids = surface.questions.map((q) => q.id);
    const store = useExamSessionStore.getState();
    if (store.examId !== sessionId || store.studentId !== studentId) {
      const limit = detail.rules.maxFocusLoss;
      store.init({
        examId: sessionId,
        studentId,
        qids,
        durationMin: detail.durationMinutes,
        ...(limit === null ? {} : { maxFocusLoss: limit }),
      });
    }

    // 服务端是权威：截止时间、切屏上限、作答状态一律以服务端为准。
    useExamSessionStore.getState().restore({
      qids,
      deadlineAt: Date.parse(surface.deadlineAt),
      remainingSec: surface.remainingSeconds,
      attemptNo: surface.attemptNo,
      maxFocusLoss: detail.rules.maxFocusLoss ?? 3,
      submitted: isFinished(surface.status),
      startedAt: surface.startedAt,
    });
  }, [enabled, surface, detail, sessionId, studentId]);

  /* -------------------------------------------------------- 同步引擎 */

  useEffect(() => {
    if (!enabled || !surface) return;

    const attemptId = surface.attemptId;
    const engine = new SyncEngine({
      attemptId,
      transport: new HttpAnswerTransport(apiBaseUrl(), getAccessToken, () => keyMapRef.current),
      keyMap: () => keyMapRef.current,
      onStatusChange: (status) => {
        setOffline(status.offline);
        setPending(status.pending);
        setSyncing(status.syncing);
      },
    });
    engineRef.current = engine;

    // 断点恢复：以服务端为准对账，服务端有本地没有的答案回填本地。
    void engine.reconcile().then(({ answers, submitted }) => {
      for (const [qid, payload] of Object.entries(answers)) {
        useExamSessionStore.getState().setAnswer(qid, payload);
      }
      if (submitted) {
        useExamSessionStore.getState().markSubmitted();
        setBlocked("already_submitted");
      }
    });

    // 页面隐藏时立即上行——切走前把答案送出去。
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 关闭页面前用 keepalive 发最后一批；不可用时靠 L2 的 IndexedDB 兜底。
    const onBeforeUnload = () => {
      void engine.flushWithBeacon(
        getAccessToken(),
        `${apiBaseUrl()}${ENDPOINTS.delivery.attemptAnswers(attemptId)}`,
      );
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      engine.dispose();
      engineRef.current = null;
    };
  }, [enabled, surface]);

  /* ------------------------------------------------------------ 计时 */

  const timeSource = useMemo(
    () => ({
      fetch: async (): Promise<number> => {
        try {
          return await createHttpServerTimeSource().fetch();
        } catch {
          return Date.now();
        }
      },
    }),
    [],
  );
  const { serverNow, driftDetected } = useServerTime(timeSource, enabled && Boolean(surface));
  // 时钟偏移突变时提示用户（FR-DLV-04）：考试中改系统时间要看得见。
  useClockDriftNotice(driftDetected);

  useEffect(() => {
    if (!enabled || !surface) return;
    const timer = setInterval(() => {
      useExamSessionStore.getState().tick(serverNow());
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, surface, serverNow]);

  /* ------------------------------------------------------------ 心跳 */

  useEffect(() => {
    if (!enabled || !surface || !detail) return;
    if (!detail.rules.enableHeartbeatCheck) return;

    const seconds = Math.max(10, detail.rules.heartbeatIntervalSeconds || 30);
    const timer = setInterval(() => {
      void heartbeatAttempt(surface.attemptId)
        .then((result) => {
          // 服务端判定已交卷（例如断网超时代交）时，本地状态跟着走。
          if (result.submitted) {
            useExamSessionStore.getState().markSubmitted();
            setSubmitReason(result.submitReason || null);
            setBlocked("already_submitted");
          }
        })
        .catch(() => {
          // 心跳失败由服务端的断连计数处理，这里不打扰考生。
        });
    }, seconds * 1000);

    return () => clearInterval(timer);
  }, [enabled, surface, detail]);

  /* ---------------------------------------------------------- 切屏采集 */

  const maxFocusLoss = detail?.rules.maxFocusLoss ?? 3;

  const onFocusEvent = useCallback((event: { type: string; clientAt: string }) => {
    const attemptId = surfaceRef.current?.attemptId;
    if (!attemptId) return;

    // 客户端只上报：切屏计数与强制交卷都由服务端裁决。
    void reportFocusEvents(attemptId, [{ type: event.type, clientAt: event.clientAt }])
      .then((result) => {
        setFocusLossCount(result.focusLossCount);
        useExamSessionStore.getState().setFocusLossCount(result.focusLossCount);
        if (result.forcedSubmit) {
          const reason = `切屏次数已达上限（${result.limit ?? maxFocusLoss} 次），已强制交卷`;
          setSubmitReason(reason);
          useExamSessionStore.getState().markForcedSubmit(reason);
          setBlocked("already_submitted");
        }
      })
      .catch(() => {
        // 上报失败不打断作答。
      });
  }, [maxFocusLoss]);

  useFocusGuard({
    enabled: enabled && Boolean(surface) && !session.submitted,
    requireFullscreen: detail?.rules.requireFullScreen ?? false,
    onEvent: (event) => {
      if (!event.countsAsFocusLoss) return;
      onFocusEvent(event);
    },
  });

  /* ------------------------------------------------------------ 作答 */

  const record = useCallback((qid: string, next: ExamResponses[string]) => {
    const store = useExamSessionStore.getState();
    store.setAnswer(qid, toPayload(next));
    // L2 落盘 + L3/L4 上行（引擎内部防抖）。
    engineRef.current?.recordAnswer(qid, toPayload(next));
  }, []);

  const responses = session.responses;

  const choose = useCallback(
    (qid: string, keys: string[]) => {
      record(qid, { ...(responses[qid] ?? {}), choice: keys });
    },
    [record, responses],
  );

  const writeText = useCallback(
    (qid: string, text: string) => {
      record(qid, { ...(responses[qid] ?? {}), text });
    },
    [record, responses],
  );

  const writeStep = useCallback(
    (qid: string, stepId: string, text: string) => {
      const previous = responses[qid]?.steps ?? {};
      record(qid, { ...(responses[qid] ?? {}), steps: { ...previous, [stepId]: text } });
    },
    [record, responses],
  );

  const toggleFlag = useCallback((qid: string) => {
    useExamSessionStore.getState().toggleFlag(qid);
  }, []);

  const goto = useCallback((index: number) => {
    useExamSessionStore.getState().goto(index);
    // 切题时立即上行——离开的题目答案先送出去。
    void engineRef.current?.flush();
  }, []);

  const flush = useCallback(() => {
    void engineRef.current?.flush();
  }, []);

  /* ------------------------------------------------------------ 交卷 */

  const submit = useCallback(
    (auto = false) => {
      const current = surfaceRef.current;
      if (!current) return;

      void (async () => {
        try {
          // 交卷前先把最后一批答案送上去——否则最后一段作答会丢。
          await engineRef.current?.flush();
          const result = await submitAttempt(current.attemptId);

          useExamSessionStore.getState().markSubmitted();
          setSubmittedAt(result.submittedAt);
          setSubmitReason(result.submitReasonLabel || (auto ? "考试时间到，已自动交卷" : null));
          void clearDraft(current.attemptId);

          toast.ok(auto ? "考试时间到，已自动交卷" : "已交卷，正在生成成绩报告");
          navigate(`/exams/${sessionId}/report`);
        } catch {
          toast.error("交卷失败，请检查网络后重试");
        }
      })();
    },
    [sessionId, navigate],
  );

  const forceSubmit = useCallback(
    (reason: string) => {
      // 服务端已经强制交卷（切屏超限），这里只是把本地状态同步过来。
      setSubmitReason(reason);
      useExamSessionStore.getState().markForcedSubmit(reason);
      setBlocked("already_submitted");
    },
    [],
  );

  /* ------------------------------------------------------------ 汇总 */

  const answeredCount = countAnswered(responses, questionMap);
  const total = paper?.items.length ?? 0;
  const current = paper?.items[session.current] ?? null;

  let effectiveBlock: SessionBlockReason = blocked;
  if (enabled && !effectiveBlock && session.submitted) effectiveBlock = "already_submitted";
  if (
    enabled &&
    !effectiveBlock &&
    session.deadlineAt !== null &&
    session.remainingSec <= 0 &&
    !session.submitted
  ) {
    effectiveBlock = "time_up";
  }

  // 倒计时归零：自动交卷（服务端按 time_up 裁决）。
  useEffect(() => {
    if (!enabled) return;
    if (effectiveBlock !== "time_up" || session.submitted) return;
    if (session.deadlineAt === null) return;
    submit(true);
  }, [enabled, effectiveBlock, session.submitted, session.deadlineAt, submit]);

  return {
    exam,
    paper,
    current,
    questionMap,
    responses,
    flags: session.flags,
    answeredCount,
    blankCount: Math.max(0, total - answeredCount),
    remainingSec: session.remainingSec,
    focusLossCount,
    maxFocusLoss,
    offline,
    pending,
    syncing,
    submitted: session.submitted,
    submittedAt: submittedAt ?? session.submittedAt,
    submitReason,
    blocked: enabled ? effectiveBlock : null,
    choose,
    writeText,
    writeStep,
    toggleFlag,
    goto,
    submit,
    forceSubmit,
    flush,
  };
}
