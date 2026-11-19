/* ==========================================================================
   知行测评 · 管理端组卷的数据通路
   --------------------------------------------------------------------------
   试卷与练习各有一份 mock / HTTP 实现，页面只认这里定义的形状。

   五处口径差异要注意（页面不知道，数据通路知道）：

   1. **题序规则**：服务端存 `by_type` / `manual`，前端叫「按题型分块 / 按选题顺序」。
   2. **卷型**：服务端存 `standard` / `small_plum` / `large_plum`，前端叫
      「标准卷 / 小梅花 / 大梅花」。
   3. **答案公布时机**：服务端存 `immediately` / `after_submit` / `after_close`，
      前端叫「结束后立即公布 / 结束后仅交卷者公布 / 结束后全员公布」。
   4. **名单与开放时间不在试卷上**：它们属于**场次**（`/exam-sessions`）——
      HTTP 模式的试卷没有名单（`scope` 恒为空）。
   5. **状态**：服务端是 `draft` / `published` / `archived`，前端的考试卷另有
      「进行中 / 已结束」的运行时状态——HTTP 模式只用服务端的三态。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPaper as createRemotePaper,
  deletePaper as deleteRemotePaper,
  isBackendEnabled,
  loadPaper,
  loadPapers,
  loadQuestion,
  loadQuestions,
  publishPaper,
  replacePaperItems,
  unpublishPaper,
  updatePaper,
  type AdminPaperDetail,
} from "@exam/shared/api";
import type {
  ExamPaper,
  OrderRule,
  PaperItem,
  PaperMode,
  Practice,
  PublishAnswerPolicy,
} from "@exam/shared/domain/types";
import {
  createExam,
  createPractice,
  itemsOf,
  matchTagFilter,
  plumCfgOf,
  removePaper,
  setExamMeta,
  setPaperItems,
  setPlumCfg,
  setPracticeMeta,
  useCatalog,
} from "@exam/shared/mock/catalog";

/** 向导看到的卷对象（mock 与 HTTP 同一形状）。 */
export interface PaperView {
  id: string;
  kind: "exam" | "practice";
  name: string;
  /** 考试批次（练习为空）。 */
  batch: string;
  /** 说明 / 考生须知。 */
  note: string;
  durationMin: number;
  /** 目标总分。 */
  targetTotalScore: number;
  passScore: number;
  /** 题序规则。 */
  orderRule: OrderRule;
  /** 卷型。 */
  mode: PaperMode;
  /** 答案公布时机（考试卷）。 */
  publishAnswer: PublishAnswerPolicy;
  /** 是否允许重考（考试卷）。 */
  allowRetake: boolean;
  /** 最大提交次数，0 = 不限（练习卷）。 */
  repeats: number;
  /** 解析反馈时机（练习卷）。 */
  feedback: "after_submit" | "immediate";
  /** 错题是否回流错题本（练习卷）。 */
  mistakeReflow: boolean;
  /** 题位。 */
  items: PaperItem[];
  /** 标签 ID。 */
  tags: string[];
  /** 是否已发布。 */
  published: boolean;
  /** 服务端状态：draft / published / archived。 */
  status: string;
  /** 名单组（HTTP 模式恒为空：名单在���次上）。 */
  scope: string[];
}

/** 组卷清单的一行（mock 与 HTTP 同一形状）。 */
export interface AdminPaperRow {
  id: string;
  kind: "exam" | "practice";
  name: string;
  /** 考试批次 / 练习说明。 */
  sub: string;
  status: string;
  statusLabel: string;
  durationMin: number;
  targetTotalScore: number;
  /** 题位分值之和。 */
  totalScore: number;
  itemCount: number;
  passScore: number;
  /** 卷型。 */
  mode: PaperMode;
  published: boolean;
  /** 标签 ID（HTTP 模式的列表摘要里没有标签，进标签弹窗时再取）。 */
  tags: string[];
}

/* ------------------------------------------------------------ 口径转换 */

/** 服务端题序规则 → 前端口径。 */
export function toOrderRule(storage: string): OrderRule {
  return storage === "manual" ? "manual" : "type";
}

/** 前端题序规则 → 服务端口径。 */
export function fromOrderRule(rule: OrderRule): string {
  return rule === "manual" ? "manual" : "by_type";
}

/** 服务端卷型 → 前端口径。 */
export function toPaperMode(storage: string): PaperMode {
  if (storage === "small_plum") return "small";
  if (storage === "large_plum") return "large";
  return "standard";
}

/** 前端卷型 → 服务端口径。 */
export function fromPaperMode(mode: PaperMode): string {
  if (mode === "small") return "small_plum";
  if (mode === "large") return "large_plum";
  return "standard";
}

/** 服务端答案公布时机 → 前端口径。 */
export function toPublishAnswer(storage: string): PublishAnswerPolicy {
  if (storage === "immediately") return "on_open";
  if (storage === "after_submit") return "after_submit";
  return "after_close";
}

/** 前端答案公布时机 → 服务端口径。 */
export function fromPublishAnswer(policy: PublishAnswerPolicy): string {
  if (policy === "on_open") return "immediately";
  if (policy === "after_submit") return "after_submit";
  return "after_close";
}

/** 试卷详情 → 向导看到的卷对象。 */
export function toPaperView(detail: AdminPaperDetail): PaperView {
  const practice = detail.practiceRules as Record<string, unknown> | null;
  return {
    id: detail.paper.id,
    kind: detail.paper.kind === "practice" ? "practice" : "exam",
    name: detail.paper.name,
    batch: detail.paper.batch,
    note: detail.note,
    durationMin: detail.paper.durationMinutes,
    targetTotalScore: detail.paper.targetTotalScore,
    passScore: detail.paper.passScore ?? 0,
    orderRule: toOrderRule(detail.orderRule),
    mode: toPaperMode(detail.variantRule),
    publishAnswer: toPublishAnswer(detail.answerPolicy),
    allowRetake: detail.allowRetake,
    repeats: numOf(practice?.maxAttempts),
    feedback: practice?.feedbackTiming === "immediate" ? "immediate" : "after_submit",
    mistakeReflow: practice?.reflowMistakes !== false,
    items: detail.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({ qid: item.questionId, score: item.score })),
    tags: detail.tagIds,
    published: detail.paper.status === "published",
    status: detail.paper.status,
    scope: [],
  };
}

function numOf(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* -------------------------------------------------------------- 卷清单 */

/** 组卷清单与新建 / 删除。 */
export function useAdminPapers(kind: "exam" | "practice"): {
  papers: AdminPaperRow[];
  loading: boolean;
  refresh: () => void;
  /** 新建卷，返回新卷 ID。 */
  create: (name: string) => Promise<string>;
  /** 删除卷。 */
  remove: (id: string) => Promise<void>;
} {
  const remote = isBackendEnabled();
  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);

  const [remoteRows, setRemoteRows] = useState<AdminPaperRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await loadPapers({ kind, size: 100 });
        if (cancelled) return;
        setRemoteRows(
          page.items.map((paper) => ({
            id: paper.id,
            kind: paper.kind === "practice" ? "practice" : "exam",
            name: paper.name,
            sub: paper.batch || paper.description || "",
            status: paper.status,
            statusLabel: paper.statusLabel,
            durationMin: paper.durationMinutes,
            targetTotalScore: paper.targetTotalScore,
            totalScore: paper.totalItemScore,
            itemCount: paper.itemCount,
            passScore: paper.passScore ?? 0,
            mode: "standard",
            published: paper.status === "published",
            tags: [],
          })),
        );
      } catch {
        if (!cancelled) setRemoteRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, kind, token]);

  const mockRows = useMemo<AdminPaperRow[]>(() => {
    const list = kind === "exam" ? exams : practices;
    return list.map((item) => {
      const items = itemsOf(item);
      return {
        id: item.id,
        kind,
        name: item.name,
        sub:
          kind === "exam"
            ? ((item as ExamPaper).batch ?? "")
            : ((item as Practice).note ?? ""),
        status: item.status,
        statusLabel:
          kind === "exam"
            ? (item as ExamPaper).published
              ? "进行中"
              : "未发布"
            : item.status === "published"
              ? "已上架"
              : "未上架",
        durationMin: item.durationMin,
        targetTotalScore: item.totalScore,
        totalScore: items.reduce((sum, i) => sum + i.score, 0),
        itemCount: items.length,
        passScore: kind === "exam" ? (item as ExamPaper).passScore : 0,
        mode: kind === "exam" ? plumCfgOf(item.id).mode : "standard",
        published: kind === "exam" ? (item as ExamPaper).published : item.status === "published",
        tags: item.tags ?? [],
      };
    });
  }, [exams, practices, kind]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const create = useCallback(
    async (name: string) => {
      if (!remote) {
        if (kind === "exam") {
          const result = createExam({ name, scope: [], orderRule: "type" });
          if (!result.ok || !result.exam) throw new Error(result.message ?? "创建失败");
          return result.exam.id;
        }
        const result = createPractice({ name, scope: [], orderRule: "type" });
        if (!result.ok || !result.practice) throw new Error(result.message ?? "创建失败");
        return result.practice.id;
      }
      const detail = await createRemotePaper({
        kind,
        name,
        targetTotalScore: 100,
        durationMinutes: kind === "exam" ? 60 : 20,
        passScore: kind === "exam" ? 60 : null,
        tagIds: [],
        orderRule: "by_type",
        variantRule: "standard",
        answerPolicy: "after_close",
        allowRetake: false,
        retakeKeepsBest: true,
      });
      refresh();
      return detail.paper.id;
    },
    [remote, kind, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!remote) {
        const result = removePaper(kind, id);
        if (!result.ok) throw new Error(result.message ?? "删除失败");
        return;
      }
      await deleteRemotePaper(id);
      refresh();
    },
    [remote, kind, refresh],
  );

  return {
    papers: remote ? remoteRows : mockRows,
    loading,
    refresh,
    create,
    remove,
  };
}

/* ------------------------------------------------------------ 向导读写 */

/** 单个卷对象的读写。 */
export function useAdminPaper(id: string): {
  paper: PaperView | null;
  loading: boolean;
  refresh: () => void;
  /** 改基本信息（服务端是整份覆盖，这里合并后提交）。 */
  saveMeta: (patch: Partial<PaperView>) => Promise<void>;
  /** 改题位。 */
  setItems: (items: PaperItem[]) => Promise<void>;
  /** 改卷型。 */
  setMode: (mode: PaperMode) => Promise<void>;
  /** 发布。警告项需要给覆盖理由。 */
  publish: (reason?: string) => Promise<void>;
  /** 撤回发布。 */
  unpublish: () => Promise<void>;
} {
  const remote = isBackendEnabled();
  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);

  const [detail, setDetail] = useState<AdminPaperDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote || !id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const loaded = await loadPaper(id);
        if (!cancelled) setDetail(loaded);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, id, token]);

  const mockPaper = useMemo<PaperView | null>(() => {
    if (remote) return null;
    const item = exams.find((e) => e.id === id) ?? practices.find((p) => p.id === id);
    if (!item) return null;
    const isExam = exams.some((e) => e.id === id);
    const exam = item as ExamPaper;
    const practice = item as Practice;
    return {
      id: item.id,
      kind: isExam ? "exam" : "practice",
      name: item.name,
      batch: isExam ? (exam.batch ?? "") : "",
      note: item.note ?? "",
      durationMin: item.durationMin,
      targetTotalScore: item.totalScore,
      passScore: isExam ? (exam.passScore ?? 0) : 0,
      orderRule: item.orderRule,
      mode: isExam ? plumCfgOf(item.id).mode : "standard",
      publishAnswer: isExam ? (exam.publishAnswer ?? "after_close") : "after_close",
      allowRetake: isExam ? (exam.allowRetake ?? false) : false,
      repeats: isExam ? 0 : (practice.repeats ?? 0),
      feedback: isExam ? "after_submit" : (practice.feedback ?? "after_submit"),
      mistakeReflow: isExam ? true : (practice.mistakeReflow ?? true),
      items: itemsOf(item),
      tags: item.tags,
      published: isExam ? exam.published : item.status === "published",
      status: item.status,
      scope: [...item.scope],
    };
  }, [remote, exams, practices, id]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const paper = useMemo<PaperView | null>(
    () => (remote ? (detail ? toPaperView(detail) : null) : mockPaper),
    [remote, detail, mockPaper],
  );

  /** 合并后的服务端写入内容。 */
  const buildBody = useCallback(
    (patch: Partial<PaperView>) => {
      const current = paper;
      if (!current) throw new Error("试卷不存在");
      const merged = { ...current, ...patch };
      return {
        name: merged.name,
        batch: merged.batch || null,
        description: merged.note || null,
        targetTotalScore: merged.targetTotalScore,
        durationMinutes: merged.durationMin,
        passScore: merged.kind === "exam" ? merged.passScore : null,
        note: merged.note || null,
        tagIds: merged.tags,
        orderRule: fromOrderRule(merged.orderRule),
        variantRule: fromPaperMode(merged.mode),
        answerPolicy: fromPublishAnswer(merged.publishAnswer),
        allowRetake: merged.allowRetake,
        retakeKeepsBest: true,
        examRules: detail?.examRules ?? null,
        practiceRules:
          merged.kind === "practice"
            ? {
                maxAttempts: merged.repeats,
                feedbackTiming: merged.feedback,
                reflowMistakes: merged.mistakeReflow,
                suggestedMinutes: merged.durationMin,
              }
            : null,
      };
    },
    [paper, detail],
  );

  const saveMeta = useCallback(
    async (patch: Partial<PaperView>) => {
      if (!remote) {
        const current = paper;
        if (!current) throw new Error("试卷不存在");
        if (current.kind === "exam") {
          const result = setExamMeta(current.id, {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.batch !== undefined ? { batch: patch.batch } : {}),
            ...(patch.note !== undefined ? { note: patch.note } : {}),
            ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
            ...(patch.targetTotalScore !== undefined
              ? { totalScore: patch.targetTotalScore }
              : {}),
            ...(patch.passScore !== undefined ? { passScore: patch.passScore } : {}),
            ...(patch.publishAnswer !== undefined
              ? { publishAnswer: patch.publishAnswer }
              : {}),
            ...(patch.allowRetake !== undefined ? { allowRetake: patch.allowRetake } : {}),
            ...(patch.orderRule !== undefined ? { orderRule: patch.orderRule } : {}),
            ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          });
          if (!result.ok) throw new Error(result.message ?? "保存失败");
          return;
        }
        const result = setPracticeMeta(current.id, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
          ...(patch.repeats !== undefined ? { repeats: patch.repeats } : {}),
          ...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
          ...(patch.mistakeReflow !== undefined ? { mistakeReflow: patch.mistakeReflow } : {}),
          ...(patch.orderRule !== undefined ? { orderRule: patch.orderRule } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      const body = buildBody(patch);
      const updated = await updatePaper(id, body);
      setDetail(updated);
    },
    [remote, paper, id, buildBody],
  );

  const setItems = useCallback(
    async (items: PaperItem[]) => {
      if (!remote) {
        const current = paper;
        if (!current) throw new Error("试卷不存在");
        const result = setPaperItems(current.kind, current.id, items);
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      const updated = await replacePaperItems(
        id,
        items.map((item, index) => ({
          questionId: item.qid,
          score: item.score,
          sortOrder: index,
        })),
      );
      setDetail(updated);
    },
    [remote, paper, id],
  );

  const setMode = useCallback(
    async (mode: PaperMode) => {
      if (!remote) {
        const current = paper;
        if (!current) throw new Error("试卷不存在");
        setPlumCfg(current.id, { mode });
        return;
      }
      const body = buildBody({ mode });
      const updated = await updatePaper(id, body);
      setDetail(updated);
    },
    [remote, paper, id, buildBody],
  );

  const publish = useCallback(
    async (reason?: string) => {
      if (!remote) return;
      await publishPaper(id, reason);
      refresh();
    },
    [remote, id, refresh],
  );

  const unpublish = useCallback(
    async () => {
      if (!remote) return;
      await unpublishPaper(id);
      refresh();
    },
    [remote, id, refresh],
  );

  return { paper, loading, refresh, saveMeta, setItems, setMode, publish, unpublish };
}

/* -------------------------------------------------------------- 题目池 */

/** 题目池里的一道题（mock 与 HTTP 同一形状）。 */
export interface PoolQuestion {
  id: string;
  /** 题号。 */
  code: string;
  stem: string;
  type: string;
  score: number;
  tagIds: string[];
}

/**
 * 组卷选题的题目池。
 *
 * HTTP 模式：过滤在**服务端**（题目可能成千上万）。
 * 题库筛选要按题库分别取（服务端一次只认一个题库），再合并去重；
 * 题型多选时服务端一次只认一个题型，多出来的在前端筛。
 */
export function usePaperQuestionPool(filters: {
  bankIds: string[];
  types: string[];
  tagIds: string[];
  keyword: string;
  enabled: boolean;
}): { questions: PoolQuestion[]; total: number; loading: boolean } {
  const remote = isBackendEnabled();
  const mockQuestions = useCatalog((state) => state.questions);
  const mockBanks = useCatalog((state) => state.banks);

  const [remoteQuestions, setRemoteQuestions] = useState<PoolQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const bankKey = filters.bankIds.join(",");
  const typeKey = filters.types.join(",");
  const tagKey = filters.tagIds.join(",");
  // 标签数组：按 tagKey 派生一份引用稳定的数组——
  // 依赖里放数组会每次渲染都换引用，effect 就跟着不停重取。
  const tagIds = useMemo(() => (tagKey ? tagKey.split(",") : []), [tagKey]);
  // 题型多选时交给前端筛（服务端一次只认一个题型）。
  const singleType = filters.types.length === 1 ? filters.types[0] : undefined;

  useEffect(() => {
    if (!remote || !filters.enabled) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const banks = bankKey ? bankKey.split(",") : [""];
        const pages = await Promise.all(
          banks.map((bankId) =>
            loadQuestions({
              ...(bankId ? { bankId } : {}),
              status: "published",
              ...(singleType ? { type: singleType } : {}),
              ...(tagIds.length ? { tagIds } : {}),
              ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
              size: 200,
            }),
          ),
        );
        if (cancelled) return;
        const merged = new Map<string, PoolQuestion>();
        for (const page of pages) {
          for (const item of page.items) {
            if (merged.has(item.id)) continue;
            merged.set(item.id, {
              id: item.id,
              code: item.code,
              stem: item.stem,
              type: item.type,
              score: item.score,
              tagIds: item.tagIds,
            });
          }
        }
        const list = [...merged.values()].filter(
          (question) => filters.types.length === 0 || filters.types.includes(question.type),
        );
        setRemoteQuestions(list);
        setTotal(list.length);
      } catch {
        if (!cancelled) {
          setRemoteQuestions([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, filters.enabled, bankKey, typeKey, tagIds, singleType, filters.keyword, filters.types]);

  const mockRows = useMemo<PoolQuestion[]>(() => {
    if (remote || !filters.enabled) return [];
    return mockQuestions
      .filter((question) => question.status === "published")
      .filter((question) => {
        if (filters.bankIds.length > 0) {
          const inBank = mockBanks.some(
            (bank) => filters.bankIds.includes(bank.id) && bank.questionIds.includes(question.id),
          );
          if (!inBank) return false;
        }
        if (filters.types.length > 0 && !filters.types.includes(question.type)) return false;
        // 标签命中口径与服务端一致：默认含子标签、任一命中。
        if (!matchTagFilter(question, filters.tagIds)) {
          return false;
        }
        if (filters.keyword) {
          const kw = filters.keyword.toLowerCase();
          if (!`${question.id} ${question.code ?? ""} ${question.stem}`.toLowerCase().includes(kw)) {
            return false;
          }
        }
        return true;
      })
      .map((question) => ({
        id: question.id,
        code: question.code ?? question.id,
        stem: question.stem,
        type: question.type,
        score: question.score,
        tagIds: question.tags,
      }));
  }, [remote, mockQuestions, mockBanks, filters]);

  return {
    questions: remote ? remoteQuestions : mockRows,
    total: remote ? total : mockRows.length,
    loading,
  };
}

/**
 * 已选题目的详情。
 *
 * HTTP 模式：已选的题可能被当前的筛选条件筛掉（题库里翻不到），
 * 这里按 ID 单独取回来——题位上要显示题干与题型。
 */
export function usePickedQuestions(ids: readonly string[]): Record<string, PoolQuestion> {
  const remote = isBackendEnabled();
  const mockQuestions = useCatalog((state) => state.questions);

  const [remoteDetails, setRemoteDetails] = useState<Record<string, PoolQuestion>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (!remote || ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const missing = ids.filter((id) => !(id in remoteDetails));
      if (missing.length === 0) return;
      const details = await Promise.all(
        missing.map(async (id) => {
          try {
            const detail = await loadQuestion(id);
            return [
              id,
              {
                id,
                code: detail.code,
                stem: detail.stem,
                type: detail.type,
                score: detail.score,
                tagIds: detail.tagIds,
              },
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setRemoteDetails((prev) => {
        const next = { ...prev };
        for (const entry of details) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, key, ids, remoteDetails]);

  return useMemo(() => {
    if (!remote) {
      const map: Record<string, PoolQuestion> = {};
      for (const question of mockQuestions) {
        map[question.id] = {
          id: question.id,
          code: question.code ?? question.id,
          stem: question.stem,
          type: question.type,
          score: question.score,
          tagIds: question.tags,
        };
      }
      return map;
    }
    return remoteDetails;
  }, [remote, mockQuestions, remoteDetails]);
}
