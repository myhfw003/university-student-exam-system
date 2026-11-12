/* ==========================================================================
   知行测评 · 练习会话编排
   --------------------------------------------------------------------------
   与考试会话的差异（对齐原型与设计文档）：
   1. **不计时**——练习不设倒计时，也不因超时强制交卷；
   2. **不限制切屏**——练习不启用防作弊计数；
   3. 可重复次数由练习配置的 repeats 决定（0 = 不限）；
   4. 反馈时机 immediate / after_submit；
   5. 错题可回流错题本。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerPayload } from "@exam/shared/domain/attempt";
import type { GradedPaper } from "@exam/shared/engine/scoring";
import type { ExamPaper, Practice, Question } from "@exam/shared/domain/types";
import { buildPaper, type BuiltPaper, type BuiltPaperItem } from "@exam/shared/engine/paper";
import { scorePaper } from "@exam/shared/engine/scoring";
import {
  difficultyLevels,
  getQuestion,
  recordMistakes,
  savePracticeResult,
  studentPractice,
} from "@exam/shared/mock/catalog";
import { clearDraft } from "@/stores/draftQueue";
import { SyncEngine } from "@/lib/syncEngine";
import { MockAnswerTransport } from "@/lib/transports";
import { useStudentStore } from "@/stores/studentStore";
import { usePracticeSessionStore, type PracticeSessionState } from "@/stores/practiceSessionStore";
import type { ExamResponses } from "@/stores/examSessionStore";

/** 模拟传输层单例——与考试会话共用一份「服务端」状态。 */
const mockTransport = new MockAnswerTransport();

/** 练习会话控制器。 */
export interface PracticeSessionController {
  /** 练习。 */
  practice: Practice | null;
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
  /** 待订正题数（部分正确 + 错误）。 */
  wrongCount: number;
  /** 判分结果。 */
  result: GradedPaper | null;
  /** 是否已提交。 */
  submitted: boolean;
  /** 已用秒数。 */
  elapsedSec: number;
  /** 离线状态。 */
  offline: boolean;
  /** 待同步批次。 */
  pending: number;
  /** 是否正在上行。 */
  syncing: boolean;
  /** 剩余可提交次数；null = 不限。 */
  remainingAttempts: number | null;
  /** 选择选项。 */
  choose: (qid: string, keys: string[]) => void;
  /** 写简答文本。 */
  writeText: (qid: string, text: string) => void;
  /** 写综合题步骤文本。 */
  writeStep: (qid: string, stepId: string, text: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转。 */
  goto: (index: number) => void;
  /** 提交。 */
  submit: () => { ok: boolean; message?: string };
  /** 重新练习。 */
  redo: () => { ok: boolean; message?: string };
}

/** 错因文案——按题型归类。 */
function mistakeReason(type: string): string {
  switch (type) {
    case "multi":
      return "多选题漏选或错选";
    case "single":
      return "单选题选项判断错误";
    case "judge":
      return "判断题结论错误";
    case "short":
      return "简答题要点未覆盖";
    case "comprehensive":
      return "综合操作题步骤缺失";
    default:
      return "本题作答未得分";
  }
}

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

export function usePracticeSession(practiceId: string): PracticeSessionController {
  const studentId = useStudentStore((state) => state.studentId);
  const session = usePracticeSessionStore();
  const engineRef = useRef<SyncEngine | null>(null);

  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const practice = useMemo(() => studentPractice(practiceId, studentId), [practiceId, studentId]);

  // 练习卷不生成梅花卷变体——按标准卷构建，只保留题序与配分。
  const paper = useMemo(() => {
    if (!practice) return null;
    const examLike = {
      id: practice.id,
      questionIds: practice.questionIds,
      items: practice.items,
      orderRule: practice.orderRule,
      plum: { mode: "standard" },
    } as unknown as ExamPaper;
    return buildPaper(examLike, studentId, { mode: "standard" }, getQuestion, difficultyLevels());
  }, [practice, studentId]);

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const item of paper?.items ?? []) {
      if (item.question) map.set(item.qid, item.question);
    }
    return map;
  }, [paper]);

  const responses = session.responses;
  const flags = session.flags;

  useEffect(() => {
    if (!practice || !paper) return;
    // 直接读 store 当前值，避免把整个会话对象挂进依赖。
    const current = usePracticeSessionStore.getState();
    if (current.practiceId !== practiceId) {
      current.init({
        practiceId,
        studentId,
        qids: paper.items.map((i) => i.qid),
      });
    }
  }, [practiceId, studentId, practice, paper]);

  useEffect(() => {
    if (!paper) return;
    const engine = new SyncEngine({
      attemptId: practiceId,
      transport: mockTransport,
      onStatusChange: (status) => {
        setOffline(status.offline);
        setPending(status.pending);
        setSyncing(status.syncing);
      },
    });
    engineRef.current = engine;

    void engine.reconcile().then(({ answers }) => {
      for (const [qid, payload] of Object.entries(answers)) {
        usePracticeSessionStore.getState().setAnswer(qid, payload);
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      engine.dispose();
      engineRef.current = null;
    };
  }, [practiceId, paper]);

  // 练习不计时，但累计用时用于结果页展示。
  useEffect(() => {
    if (!practice || session.submitted) return;
    const timer = setInterval(() => {
      usePracticeSessionStore.getState().tick();
    }, 1000);
    return () => clearInterval(timer);
  }, [practice, session.submitted]);

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

  const submit = useCallback((): { ok: boolean; message?: string } => {
    if (!practice || !paper) return { ok: false };

    const store = usePracticeSessionStore.getState();
    const used = store.attempts;
    if (practice.repeats > 0 && used >= practice.repeats) {
      return { ok: false, message: `「${practice.name}」最多提交 ${practice.repeats} 次，已用完` };
    }

    const graded = scorePaper(paper, responses);
    store.markSubmitted(graded);

    savePracticeResult({
      practiceId: practice.id,
      studentId,
      score: graded.total,
      total: graded.totalMax,
      attempts: store.attempts + 1,
      submittedAt: new Date().toISOString(),
    });

    // 错题回流：答错的记入错题本；单题重做答对则出册。
    const wrongDetails = graded.details
      .filter((d) => d.status === "wrong" || d.status === "partial")
      .map((d) => ({ qid: d.qid, status: d.status, reason: mistakeReason(d.type) }));
    recordMistakes(wrongDetails, studentId, {
      reflow: practice.mistakeReflow,
      removeOnCorrect: false,
    });

    void clearDraft(practiceId);
    void engineRef.current?.flush();
    return { ok: true };
  }, [practice, paper, responses, studentId, practiceId]);

  const redo = useCallback((): { ok: boolean; message?: string } => {
    if (!practice) return { ok: false };
    const store = usePracticeSessionStore.getState();
    if (practice.repeats > 0 && store.attempts >= practice.repeats) {
      return { ok: false, message: `「${practice.name}」最多提交 ${practice.repeats} 次，已用完` };
    }
    store.reset();
    void clearDraft(practiceId);
    return { ok: true };
  }, [practice, practiceId]);

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

  const remainingAttempts =
    practice && practice.repeats > 0 ? Math.max(0, practice.repeats - session.attempts) : null;

  return {
    practice,
    paper,
    current: paper?.items[session.current] ?? null,
    questionMap,
    responses,
    flags,
    answeredCount,
    wrongCount,
    result: session.result,
    submitted: session.submitted,
    elapsedSec: session.elapsedSec,
    offline,
    pending,
    syncing,
    remainingAttempts,
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
export type { PracticeSessionState };
