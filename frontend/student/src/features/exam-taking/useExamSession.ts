/* ==========================================================================
   知行测评 · 考试会话编排
   --------------------------------------------------------------------------
   把「卷面构建 / 服务端计时 / 切屏采集 / 作答四层保障 / 交卷判分」
   串成一个可用的答题会话。

   关键机制（docs/design/06-frontend.md §4 §5 §6）：
   1. 倒计时以**绝对 deadlineAt** 为准——离开页面、后台标签页节流都不影响剩余时长；
   2. 时钟以**服务端时间**为权威（多次采样取中位数偏移），本机改时间无效；
   3. 切屏事件 500ms 窗口内去重，客户端只上报、计数以服务端为准；
   4. 作答经 L1 内存 → L2 IndexedDB → L3 队列 → L4 服务端，离线排队、恢复重放。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AnswerPayload } from "@exam/shared/domain/attempt";
import type { ExamPaper, Question } from "@exam/shared/domain/types";
import { buildPaper, type BuiltPaper, type BuiltPaperItem } from "@exam/shared/engine/paper";
import { scorePaper } from "@exam/shared/engine/scoring";
import {
  addReview,
  difficultyLevels,
  getQuestion,
  saveAttempt,
  studentExam,
} from "@exam/shared/mock/catalog";
import { clearDraft } from "@/stores/draftQueue";
import { SyncEngine } from "@/lib/syncEngine";
import { MockAnswerTransport } from "@/lib/transports";
import { createHttpServerTimeSource } from "@/lib/serverTimeSource";
import { useServerTime } from "@/lib/useServerTime";
import { useStudentStore } from "@/stores/studentStore";
import { countAnswered, useExamSessionStore, type ExamResponses } from "@/stores/examSessionStore";
import { useFocusGuard } from "./FocusGuard";

/** 模拟传输层单例——跨挂载保留「服务端」已接受的状态。 */
const mockTransport = new MockAnswerTransport();

/** 会话为空时的原因。 */
export type SessionBlockReason =
  | null
  | "not_found"
  | "already_submitted"
  | "ended"
  | "time_up";

/** 考试会话控制器。 */
export interface ExamSessionController {
  /** 试卷；不可见时为 null。 */
  exam: ExamPaper | null;
  /** 卷面。 */
  paper: BuiltPaper | null;
  /** 当前题位。 */
  current: BuiltPaperItem | null;
  /** 题目索引。 */
  questionMap: Map<string, Question>;
  /** 作答内容。 */
  responses: ExamResponses;
  /** 标记。 */
  flags: Record<string, boolean>;
  /** 已作答题数。 */
  answeredCount: number;
  /** 未作答题数。 */
  blankCount: number;
  /** 剩余秒数。 */
  remainingSec: number;
  /** 切屏次数（客户端上报，服务端确认前为本地计数）。 */
  focusLossCount: number;
  /** 切屏上限。 */
  maxFocusLoss: number;
  /** 是否离线。 */
  offline: boolean;
  /** 待同步批次数。 */
  pending: number;
  /** 是否正在上行。 */
  syncing: boolean;
  /** 是否已交卷。 */
  submitted: boolean;
  /** 交卷原因。 */
  submitReason: string | null;
  /** 会话被阻断的原因。 */
  blocked: SessionBlockReason;
  /** 选择选项。 */
  choose: (qid: string, keys: string[]) => void;
  /** 写简答文本。 */
  writeText: (qid: string, text: string) => void;
  /** 写综合题步骤文本。 */
  writeStep: (qid: string, stepId: string, text: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转到指定下标。 */
  goto: (index: number) => void;
  /** 交卷。 */
  submit: () => void;
  /** 强制交卷（切屏超限）。 */
  forceSubmit: (reason: string) => void;
  /** 立即同步。 */
  flush: () => void;
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

export function useExamSession(examId: string): ExamSessionController {
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);

  const session = useExamSessionStore();
  const engineRef = useRef<SyncEngine | null>(null);

  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [focusLossCount, setFocusLossCount] = useState(0);
  const [submitReason, setSubmitReason] = useState<string | null>(null);

  /* ---------------------------------------------------------------- 卷面 */

  const exam = useMemo(() => studentExam(examId, studentId), [examId, studentId]);

  const paper = useMemo(
    () =>
      exam
        ? buildPaper(exam, studentId, undefined, getQuestion, difficultyLevels())
        : null,
    [exam, studentId],
  );

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const item of paper?.items ?? []) {
      if (item.question) map.set(item.qid, item.question);
    }
    return map;
  }, [paper]);

  /* ------------------------------------------------------- 会话初始化 */

  const responses = session.responses;
  const flags = session.flags;

  useEffect(() => {
    if (!exam || !paper) return;
    // 换考试时重置会话状态。直接读 store 当前值，避免把整个会话对象挂进依赖。
    const current = useExamSessionStore.getState();
    if (current.examId !== examId) {
      current.init({
        examId,
        studentId,
        qids: paper.items.map((i) => i.qid),
        durationMin: exam.durationMin,
      });
    }
  }, [examId, studentId, exam, paper]);

  /* -------------------------------------------------------- 同步引擎 */

  useEffect(() => {
    if (!paper) return;

    const engine = new SyncEngine({
      attemptId: examId,
      transport: mockTransport,
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
      }
    });

    // 页面隐藏时立即上行——切走前把答案送出去。
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 关闭页面前用 beacon 发最后一批；不可用时靠 L2 的 IndexedDB 兜底。
    const onBeforeUnload = () => {
      void engine.flushWithBeacon(null, `/api/v1/attempts/${examId}/answers`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      engine.dispose();
      engineRef.current = null;
    };
  }, [examId, paper]);

  /* ------------------------------------------------------------ 计时 */

  const timeSource = useMemo(
    () => ({
      fetch: async (): Promise<number> => {
        // 服务端时钟优先；不可达时退回本机时间（偏移为 0）。
        try {
          return await createHttpServerTimeSource().fetch();
        } catch {
          return Date.now();
        }
      },
    }),
    [],
  );
  const { serverNow } = useServerTime(timeSource, Boolean(exam));

  useEffect(() => {
    if (!exam) return;
    const timer = setInterval(() => {
      useExamSessionStore.getState().tick(serverNow());
    }, 1000);
    return () => clearInterval(timer);
  }, [exam, serverNow]);

  /* ---------------------------------------------------------- 切屏采集 */

  useFocusGuard({
    enabled: Boolean(exam) && !session.submitted,
    requireFullscreen: false,
    onEvent: (event) => {
      if (!event.countsAsFocusLoss) return;
      // 客户端只上报，计数以服务端为准；此处先做本地反馈。
      setFocusLossCount((count) => count + 1);
    },
  });

  const maxFocusLoss = session.maxFocusLoss;

  useEffect(() => {
    // 达到切屏上限：按策略强制交卷。
    if (focusLossCount >= maxFocusLoss && !session.submitted) {
      setSubmitReason("proctor_force");
      useExamSessionStore.getState().markForcedSubmit("检测到多次切屏，系统已强制交卷。");
      void engineRef.current?.flush();
    }
  }, [focusLossCount, maxFocusLoss, session.submitted]);

  /* ------------------------------------------------------------ 作答 */

  const record = useCallback(
    (qid: string, next: ExamResponses[string]) => {
      const store = useExamSessionStore.getState();
      store.setAnswer(qid, toPayload(next));
      // L2 落盘 + L3/L4 上行（引擎内部防抖）。
      engineRef.current?.recordAnswer(qid, toPayload(next));
    },
    [],
  );

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

  const submit = useCallback(() => {
    if (!exam || !paper) return;

    const graded = scorePaper(paper, responses);
    const store = useExamSessionStore.getState();
    const attemptNo = 1;

    saveAttempt({
      examId: exam.id,
      studentId,
      submittedAt: new Date().toISOString(),
      responses,
      score: graded.total,
      total: graded.totalMax,
      pendingSubjective: graded.subjective.pending > 0,
      variantLabel: paper.variantLabel,
      attemptNo,
      attempts: attemptNo,
    });

    // 主观题入阅卷队列：简答整题一条，综合题按步骤拆开。
    graded.details.forEach((detail, index) => {
      if (detail.type !== "short" && detail.type !== "comprehensive") return;
      if (detail.type === "short") {
        addReview({
          id: `rv-live-${exam.id}-${studentId}-a${attemptNo}-${detail.qid}-q-${index}`,
          examId: exam.id,
          studentId,
          qid: detail.qid,
          stepId: null,
          attempt: attemptNo,
          answerText: detail.answerText ?? "",
          submittedAt: new Date().toISOString(),
        });
        return;
      }
      (detail.steps ?? []).forEach((step, stepIndex) => {
        addReview({
          id: `rv-live-${exam.id}-${studentId}-a${attemptNo}-${detail.qid}-${step.id}-${stepIndex}`,
          examId: exam.id,
          studentId,
          qid: detail.qid,
          stepId: step.id,
          attempt: attemptNo,
          answerText: step.answer,
          submittedAt: new Date().toISOString(),
        });
      });
    });

    store.markSubmitted();
    void clearDraft(examId);
    void engineRef.current?.flush();

    navigate(`/exams/${examId}/report`);
  }, [exam, paper, responses, studentId, examId, navigate]);

  const forceSubmit = useCallback(
    (reason: string) => {
      setSubmitReason(reason);
      useExamSessionStore.getState().markForcedSubmit(reason);
      submit();
    },
    [submit],
  );

  /* ------------------------------------------------------------ 汇总 */

  const answeredCount = countAnswered(responses, questionMap);
  const total = paper?.items.length ?? 0;
  const current = paper?.items[session.current] ?? null;

  let blocked: SessionBlockReason = null;
  if (!exam) blocked = "not_found";
  else if (session.submitted) blocked = "already_submitted";
  else if (session.remainingSec <= 0) blocked = "time_up";
  else if (exam.status === "ended" && !exam.allowRetake) blocked = "ended";

  return {
    exam,
    paper,
    current,
    questionMap,
    responses,
    flags,
    answeredCount,
    blankCount: Math.max(0, total - answeredCount),
    remainingSec: session.remainingSec,
    focusLossCount,
    maxFocusLoss,
    offline,
    pending,
    syncing,
    submitted: session.submitted,
    submitReason,
    blocked,
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
