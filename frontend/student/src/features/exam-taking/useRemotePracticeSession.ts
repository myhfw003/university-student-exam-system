/* ==========================================================================
   知行测评 · 练习会话编排（HTTP 模式）
   --------------------------------------------------------------------------
   与考试会话的差别（对齐设计文档）：练习不计时、不限制切屏、可重复若干次，
   反馈时机由练习规则说了算（`immediate` / `after_submit`）。

   与 mock 模式的差别集中在三处：

   1. **卷面来自服务端**：`POST /attempts`（practiceAssignmentId），
      练习不置换选项，但选择键的换算表照旧要交给传输层；
   2. **判分在服务端**：反馈走 `POST /attempts/{id}/feedback`，
      前端只把反馈映射成引擎的 `GradedPaper`；
   3. **错题回流在服务端**：前端不再本地记错题（那是 `/mistakes` 的事）。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@exam/shared";
import type {
  AnswerPayload,
  AttemptFeedback,
  AttemptSurface,
  PracticeSummary,
} from "@exam/shared/domain/attempt";
import type { ExamPaper, Practice, Question } from "@exam/shared/domain/types";
import { buildPaperFromSurface } from "@exam/shared/engine/paper";
import { gradedPaperFromFeedback } from "@exam/shared/engine/practice";
import type { GradedPaper } from "@exam/shared/engine/scoring";
import {
  apiBaseUrl,
  buildOptionKeyMap,
  ENDPOINTS,
  getAccessToken,
  loadAttemptFeedback,
  loadPractice,
  startPracticeAttempt,
  submitAttempt,
  type OptionKeyMap,
} from "@exam/shared/api";
import { clearDraft } from "@/stores/draftQueue";
import { SyncEngine } from "@/lib/syncEngine";
import { HttpAnswerTransport } from "@/lib/transports";
import { useStudentStore } from "@/stores/studentStore";
import { usePracticeSessionStore, type PracticeSessionState } from "@/stores/practiceSessionStore";
import type { ExamResponses } from "@/stores/examSessionStore";
import type { PracticeSessionController } from "./practiceSessionTypes";

/** 即时反馈的取数防抖（毫秒）——答题停下来一会儿再问服务端。 */
const FEEDBACK_DEBOUNCE_MS = 600;

/** 响应 → 载荷。 */
function toPayload(response: ExamResponses[string] | undefined): AnswerPayload {
  if (!response) return {};
  const payload: AnswerPayload = {};
  if (response.choice) payload.selectedOptionKeys = response.choice;
  if (response.text !== undefined) payload.text = response.text;
  if (response.steps) {
    payload.steps = Object.entries(response.steps).map(([stepCode, text]) => ({ stepCode, text }));
  }
  return payload;
}

/**
 * HTTP 模式的练习会话控制器。
 *
 * @param assignmentId 练习开放单 ID。
 * @param enabled 是否启用；mock 模式下关掉，避免两套实现同时动会话状态。
 */
export function useRemotePracticeSession(
  assignmentId: string,
  enabled = true,
): PracticeSessionController {
  const studentId = useStudentStore((state) => state.studentId);
  const session = usePracticeSessionStore();

  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [surface, setSurface] = useState<AttemptSurface | null>(null);
  const [feedback, setFeedback] = useState<AttemptFeedback | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const engineRef = useRef<SyncEngine | null>(null);
  const surfaceRef = useRef<AttemptSurface | null>(null);
  const keyMapRef = useRef<OptionKeyMap>({});
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------ 载入与开练 */

  useEffect(() => {
    if (!enabled || !assignmentId) return;
    let cancelled = false;

    void (async () => {
      try {
        // 只要这一条练习——别为了拿一条去拉整张表。
        // 看不见的开放单（不在可见范围内）服务端会 404，这里当没有。
        const practice = await loadPractice(assignmentId).catch(() => null);
        if (cancelled) return;
        setSummary(practice);

        // 开始（或续上）一次练习：服务端幂等，次数用尽时才会拒绝。
        const started = await startPracticeAttempt(assignmentId);
        if (cancelled) return;
        surfaceRef.current = started;
        keyMapRef.current = buildOptionKeyMap(started.questions);
        setSurface(started);
      } catch {
        if (!cancelled) setSurface(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, assignmentId, reloadToken]);

  /* ---------------------------------------------------------------- 卷面 */

  // 练习不置换选项：标准卷即可。
  const paper = useMemo(() => {
    if (!surface) return null;
    return buildPaperFromSurface(surface, {
      examId: assignmentId,
      studentId,
      mode: "standard",
    });
  }, [surface, assignmentId, studentId]);

  const practice = useMemo<Practice | null>(() => {
    if (!summary) return null;
    return {
      id: summary.id,
      name: summary.title,
      tags: [],
      questionIds: surface?.questions.map((q) => q.id) ?? [],
      items: (surface?.questions ?? []).map((q) => ({ qid: q.id, score: q.score })),
      durationMin: summary.suggestedMinutes,
      totalScore: summary.totalScore,
      status: "published",
      published: true,
      scope: [],
      repeats: summary.maxAttempts,
      feedback: summary.feedbackTiming === "immediate" ? "immediate" : "after_submit",
      mistakeReflow: summary.reflowMistakes,
      orderRule: "type",
      note: "",
    };
  }, [summary, surface]);

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const item of paper?.items ?? []) {
      if (item.question) map.set(item.qid, item.question);
    }
    return map;
  }, [paper]);

  /* ------------------------------------------------------- 会话初始化 */

  useEffect(() => {
    if (!enabled || !surface || !paper) return;

    const current = usePracticeSessionStore.getState();
    if (current.practiceId !== assignmentId) {
      current.init({
        practiceId: assignmentId,
        studentId,
        qids: paper.items.map((i) => i.qid),
      });
    }
  }, [enabled, surface, paper, assignmentId, studentId]);

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

    // 断点恢复：服务端有本地没有的答案回填本地。
    void engine.reconcile().then(({ answers }) => {
      for (const [qid, payload] of Object.entries(answers)) {
        usePracticeSessionStore.getState().setAnswer(qid, payload);
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

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

  /* ------------------------------------------------------------ 用时 */

  useEffect(() => {
    if (!enabled || !surface || session.submitted) return;
    const timer = setInterval(() => {
      usePracticeSessionStore.getState().tick();
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, surface, session.submitted]);

  /* -------------------------------------------------------- 即时反馈 */

  const refreshFeedback = useCallback(() => {
    const attemptId = surfaceRef.current?.attemptId;
    if (!attemptId) return;
    // 反馈要基于服务端已存的答案：先把本地这批送上去。
    void engineRef.current?.flush();
    void loadAttemptFeedback(attemptId)
      .then((loaded) => setFeedback(loaded))
      .catch(() => {
        // 反馈取不到不打断作答（`after_submit` 的练习在交卷前本来就取不到）。
      });
  }, []);

  const responses = session.responses;

  // 当前题的作答：只有它变了才需要重新问服务端。
  const currentQid = session.qids[session.current] ?? "";
  const currentResponse = currentQid ? responses[currentQid] : undefined;

  useEffect(() => {
    if (!enabled || !summary) return;
    if (summary.feedbackTiming !== "immediate") return;
    if (!currentQid || !currentResponse) return;

    // 防抖：停下来一会儿再问，别每敲一个字就问一次。
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null;
      refreshFeedback();
    }, FEEDBACK_DEBOUNCE_MS);

    return () => {
      if (feedbackTimer.current !== null) {
        clearTimeout(feedbackTimer.current);
        feedbackTimer.current = null;
      }
    };
  }, [enabled, summary, currentQid, currentResponse, refreshFeedback]);

  /* ------------------------------------------------------------ 作答 */

  const record = useCallback((qid: string, next: ExamResponses[string]) => {
    usePracticeSessionStore.getState().setAnswer(qid, toPayload(next));
    engineRef.current?.recordAnswer(qid, toPayload(next));
  }, []);

  const choose = useCallback(
    (qid: string, keys: string[]) => record(qid, { ...(responses[qid] ?? {}), choice: keys }),
    [record, responses],
  );
  const writeText = useCallback(
    (qid: string, text: string) => record(qid, { ...(responses[qid] ?? {}), text }),
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
    usePracticeSessionStore.getState().toggleFlag(qid);
  }, []);

  const goto = useCallback((index: number) => {
    usePracticeSessionStore.getState().goto(index);
    void engineRef.current?.flush();
  }, []);

  /* ------------------------------------------------------------ 提交 */

  const remainingAttempts =
    summary && summary.maxAttempts > 0
      ? Math.max(0, summary.maxAttempts - session.attempts)
      : null;

  const submit = useCallback((): { ok: boolean; message?: string } => {
    const current = surfaceRef.current;
    if (!current) return { ok: false, message: "练习还没准备好，请稍后再试。" };

    if (summary && summary.maxAttempts > 0 && summary.usedAttempts >= summary.maxAttempts) {
      return { ok: false, message: `「${summary.title}」最多提交 ${summary.maxAttempts} 次，已用完` };
    }

    void (async () => {
      try {
        // 先把最后一批答案送上去——否则最后一段作答会丢。
        await engineRef.current?.flush();
        await submitAttempt(current.attemptId);

        // 判分与解析在服务端：交卷后取一次反馈。
        const loaded = await loadAttemptFeedback(current.attemptId);
        const graded = gradedPaperFromFeedback(current, loaded, responses);
        usePracticeSessionStore.getState().markSubmitted(graded);
        setFeedback(loaded);
      } catch {
        toast.error("提交失败，请检查网络后重试");
      }
    })();

    return { ok: true };
  }, [summary, responses]);

  const redo = useCallback((): { ok: boolean; message?: string } => {
    if (summary && summary.maxAttempts > 0 && summary.usedAttempts >= summary.maxAttempts) {
      return { ok: false, message: `「${summary.title}」最多提交 ${summary.maxAttempts} 次，已用完` };
    }

    const attemptId = surfaceRef.current?.attemptId;
    usePracticeSessionStore.getState().reset();
    setFeedback(null);
    if (attemptId) void clearDraft(attemptId);
    // 重新开一次：服务端按次数开出新的作答会话。
    setReloadToken((token) => token + 1);
    return { ok: true };
  }, [summary]);

  /* ------------------------------------------------------------ 汇总 */

  const answeredCount = Object.keys(responses).filter((qid) => {
    const response = responses[qid];
    if (!response) return false;
    const type = questionMap.get(qid)?.type;
    if (type === "short") return (response.text ?? "").trim().length > 0;
    if (type === "comprehensive") {
      return Object.values(response.steps ?? {}).some((text) => text.trim().length > 0);
    }
    return (response.choice ?? []).length > 0;
  }).length;

  const wrongCount =
    session.result?.details.filter((d) => d.status === "wrong" || d.status === "partial").length ?? 0;

  return {
    practice,
    paper,
    current: paper?.items[session.current] ?? null,
    questionMap,
    responses,
    flags: session.flags,
    answeredCount,
    wrongCount,
    result: session.result,
    submitted: session.submitted,
    elapsedSec: session.elapsedSec,
    submittedAt: session.submittedAt,
    offline,
    pending,
    syncing,
    remainingAttempts,
    feedback,
    refreshFeedback,
    choose,
    writeText,
    writeStep,
    toggleFlag,
    goto,
    submit,
    redo,
  };
}

/** 供结果页使用的会话初始状态类型（避免循环依赖）。 */
export type { PracticeSessionState, GradedPaper, ExamPaper };
