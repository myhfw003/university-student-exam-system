/* ==========================================================================
   知行测评 · 管理端题库与题目的数据通路
   --------------------------------------------------------------------------
   题库清单、题库工作台与题目编辑器各有一份 mock / HTTP 实现，
   页面只认这里定义的形状。

   三处口径差异要注意（页面不知道，数据通路知道）：

   1. **题号**：mock 的题号就是 id；真实后端里 `id` 是数字主键，题号是 `code`。
   2. **题库没有标签**：后端的题库表上没有标签列，也没有关联表——
      HTTP 模式不提供题库标签（页面上的标签选择器会隐藏）。
   3. **过滤在服务端**：题目可能成千上万，状态 / 题型 / 标签 / 关键词都交给服务端筛。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addBankItems,
  batchQuestionStatus,
  createBank,
  createQuestion,
  deleteBank,
  deleteQuestion,
  getQuestionAttachmentUrl,
  isBackendEnabled,
  loadBank,
  loadBanks,
  loadQuestion,
  loadQuestions,
  removeBankItems,
  setQuestionStatus,
  toFrontendQuestion,
  updateBank,
  updateQuestion,
  type AdminQuestionDetail,
} from "@exam/shared/api";
import type { Question, QuestionType } from "@exam/shared/domain/types";
import { useCatalogTags } from "../shared/useCatalogTags";
import {
  bankStats,
  discardQuestions,
  removeBank,
  removeQuestion,
  setQuestionsStatus,
  setQuestionStatus as setMockQuestionStatus,
  upsertBank,
  upsertQuestion,
  useCatalog,
} from "@exam/shared/mock/catalog";

/** 题库统计（mock 与 HTTP 同一形状）。 */
export interface AdminBankStats {
  total: number;
  published: number;
  draft: number;
  disabled: number;
  /** 客观题分值合计（已发布）。 */
  objective: number;
  /** 主观题分值合计（已发布）。 */
  subjective: number;
}

/** 题库清单的一行。 */
export interface AdminBankRow {
  id: string;
  name: string;
  desc: string;
  /** 题库里的题目 ID。 */
  questionIds: string[];
  /** 题库挂的标签；真实后端的题库没有标签，这里为空。 */
  tags: string[];
  stats: AdminBankStats;
}

/** 题目筛选条件。 */
export interface AdminQuestionFilter {
  /** 题库 ID；空表示跨库视图。 */
  bankId: string;
  /** 状态：`published` / `draft` / `disabled` / `all`。 */
  status: string;
  /** 题型；`all` 表示不限。 */
  type: string;
  /** 关键词（题号或题干）。 */
  keyword: string;
  /** 标签筛选（任一命中）。 */
  tagIds: string[];
  /** 是否拉取；标签页切换时避免无谓的请求。 */
  enabled?: boolean;
}

/* ------------------------------------------------------------ 题库清单 */

/** 题库清单与题库增删改。 */
export function useAdminBanks(): {
  banks: AdminBankRow[];
  loading: boolean;
  refresh: () => void;
  create: (input: {
    name: string;
    desc: string;
    tags: string[];
    questionIds: string[];
  }) => Promise<void>;
  update: (id: string, input: { name: string; desc: string; tags: string[]; questionIds: string[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const remote = isBackendEnabled();
  const mockBanks = useCatalog((state) => state.banks);

  const [remoteBanks, setRemoteBanks] = useState<AdminBankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const banks = await loadBanks();
        // 题库清单的统计在详情里：逐个取详情（题库数量不多，可并行）。
        const details = await Promise.all(
          banks.map((bank) =>
            loadBank(bank.id).catch(() => null),
          ),
        );
        if (cancelled) return;
        setRemoteBanks(
          banks.map((bank, index) => {
            const detail = details[index];
            const stats = detail?.statistics;
            return {
              id: bank.id,
              name: bank.name,
              desc: bank.description,
              questionIds: (detail?.questions ?? []).map((q) => q.id),
              tags: [],
              stats: {
                total: stats?.total ?? bank.questionCount,
                published: stats?.published ?? 0,
                draft: stats?.draft ?? 0,
                disabled: stats?.disabled ?? 0,
                objective: stats?.objectiveScore ?? 0,
                subjective: stats?.subjectiveScore ?? 0,
              },
            };
          }),
        );
      } catch {
        if (!cancelled) setRemoteBanks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockRows = useMemo<AdminBankRow[]>(
    () =>
      mockBanks.map((bank) => {
        const stats = bankStats(bank.id);
        return {
          id: bank.id,
          name: bank.name,
          desc: bank.desc ?? "",
          questionIds: bank.questionIds ?? [],
          tags: bank.tags ?? [],
          stats: {
            total: stats.total,
            published: stats.published,
            draft: stats.draft,
            disabled: stats.disabled,
            objective: stats.objective,
            subjective: stats.subjective,
          },
        };
      }),
    [mockBanks],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const create = useCallback(
    async (input: { name: string; desc: string; tags: string[]; questionIds: string[] }) => {
      if (!remote) {
        const result = upsertBank({
          name: input.name,
          desc: input.desc,
          tags: input.tags,
          questionIds: input.questionIds,
        });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      const detail = await createBank({ name: input.name, description: input.desc });
      if (input.questionIds.length > 0) {
        await addBankItems(detail.bank.id, input.questionIds);
      }
      refresh();
    },
    [remote, refresh],
  );

  const update = useCallback(
    async (
      id: string,
      input: { name: string; desc: string; tags: string[]; questionIds: string[] },
    ) => {
      if (!remote) {
        const result = upsertBank({
          id,
          name: input.name,
          desc: input.desc,
          tags: input.tags,
          questionIds: input.questionIds,
        });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      await updateBank(id, { name: input.name, description: input.desc });
      const current = remoteBanks.find((bank) => bank.id === id);
      const wanted = new Set(input.questionIds);
      const existing = new Set(current?.questionIds ?? []);
      const toAdd = input.questionIds.filter((qid) => !existing.has(qid));
      const toRemove = (current?.questionIds ?? []).filter((qid) => !wanted.has(qid));
      if (toAdd.length > 0) await addBankItems(id, toAdd);
      if (toRemove.length > 0) await removeBankItems(id, toRemove);
      refresh();
    },
    [remote, refresh, remoteBanks],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!remote) {
        const result = removeBank(id);
        if (!result.ok) throw new Error(result.message ?? "删除失败");
        return;
      }
      await deleteBank(id);
      refresh();
    },
    [remote, refresh],
  );

  return {
    banks: remote ? remoteBanks : mockRows,
    loading,
    refresh,
    create,
    update,
    remove,
  };
}

/* ------------------------------------------------------------ 题目清单 */

/** 题目清单与题目动作。 */
export function useAdminQuestions(filter: AdminQuestionFilter): {
  questions: Question[];
  total: number;
  loading: boolean;
  refresh: () => void;
  setStatus: (id: string, status: Question["status"]) => Promise<void>;
  batchStatus: (
    ids: string[],
    status: Question["status"],
  ) => Promise<{ changed: number; failures: Array<{ id: string; reason: string }> }>;
  remove: (id: string) => Promise<void>;
  /** 批量丢弃（删除）候选题。 */
  discardMany: (ids: string[]) => Promise<{ changed: number; failures: Array<{ id: string; reason: string }> }>;
  /** 取回单道题的完整细节（编辑器用）。 */
  loadDetail: (id: string) => Promise<Question | null>;
  /** 保存题目（新建或更新）。 */
  save: (question: Question) => Promise<Question>;
} {
  const remote = isBackendEnabled();
  const mockQuestions = useCatalog((state) => state.questions);
  const mockBanks = useCatalog((state) => state.banks);
  // 标签目录：HTTP 模式来自服务端（标签 ID 是数字主键，本地目录的假 ID 发过去会被拒）。
  const { tags: catalogTags } = useCatalogTags();

  const [remoteQuestions, setRemoteQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    if (filter.enabled === false) {
      // 返回同一个引用：状态没变就不重渲染，避免与筛选条件互相触发。
      setRemoteQuestions((prev) => (prev.length === 0 ? prev : []));
      setTotal((prev) => (prev === 0 ? prev : 0));
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await loadQuestions({
          bankId: filter.bankId && filter.bankId !== "__all__" ? filter.bankId : undefined,
          status: filter.status,
          type: filter.type,
          keyword: filter.keyword.trim() || undefined,
          tagIds: filter.tagIds.length > 0 ? filter.tagIds : undefined,
        });
        if (cancelled) return;
        setRemoteQuestions(
          page.items.map((item) => ({
            id: item.id,
            code: item.code,
            type: item.type,
            score: item.score,
            status: item.status as Question["status"],
            source: item.source as Question["source"],
            tags: item.tagIds,
            stem: item.stem,
            answer: [],
            analysis: "",
          })),
        );
        setTotal(page.total);
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
  }, [
    remote,
    filter.bankId,
    filter.status,
    filter.type,
    filter.keyword,
    filter.tagIds,
    filter.enabled,
    token,
  ]);

  const mockRows = useMemo<Question[]>(() => {
    if (remote) return [];
    if (filter.enabled === false) return [];
    const bank = mockBanks.find((b) => b.id === filter.bankId);
    const list =
      !filter.bankId || filter.bankId === "__all__"
        ? mockQuestions
        : (bank?.questionIds ?? [])
            .map((qid) => mockQuestions.find((q) => q.id === qid))
            .filter((q): q is Question => Boolean(q));
    return list.filter((q) => {
      if (filter.status !== "all" && q.status !== filter.status) return false;
      if (filter.type !== "all" && q.type !== filter.type) return false;
      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        if (!`${q.id} ${q.code ?? ""} ${q.stem}`.toLowerCase().includes(kw)) return false;
      }
      if (filter.tagIds.length && !filter.tagIds.some((tagId) => q.tags.includes(tagId))) {
        return false;
      }
      return true;
    });
  }, [remote, mockQuestions, mockBanks, filter]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const setStatus = useCallback(
    async (id: string, status: Question["status"]) => {
      if (!remote) {
        const result = setMockQuestionStatus(id, status);
        if (!result.ok) throw new Error(result.message ?? "状态更新失败");
        refresh();
        return;
      }
      const action = status === "published" ? "publish" : status === "disabled" ? "disable" : "restore";
      await setQuestionStatus(id, action);
      refresh();
    },
    [remote, refresh],
  );

  const batchStatus = useCallback(
    async (ids: string[], status: Question["status"]) => {
      if (!remote) {
        const result = setQuestionsStatus(ids, status);
        refresh();
        return { changed: result.changed, failures: result.failures };
      }
      const result = await batchQuestionStatus(ids, status);
      refresh();
      return {
        changed: result.succeeded,
        failures: result.items
          .filter((item) => !item.succeeded)
          .map((item) => ({ id: item.questionId, reason: item.reason })),
      };
    },
    [remote, refresh],
  );

  const discardMany = useCallback(
    async (
      ids: string[],
    ): Promise<{ changed: number; failures: Array<{ id: string; reason: string }> }> => {
      if (!remote) {
        const result = discardQuestions(ids);
        refresh();
        return { changed: result.changed, failures: result.failures };
      }
      // 后端没有批量丢弃端点：逐题删除（删除是软删，附件一并软删）。
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await deleteQuestion(id);
            return { id, ok: true, reason: "" };
          } catch (error) {
            return {
              id,
              ok: false,
              reason: error instanceof Error ? error.message : "删除失败",
            };
          }
        }),
      );
      refresh();
      return {
        changed: results.filter((r) => r.ok).length,
        failures: results.filter((r) => !r.ok).map((r) => ({ id: r.id, reason: r.reason })),
      };
    },
    [remote, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!remote) {
        const result = removeQuestion(id);
        if (!result.ok) throw new Error(result.message ?? "删除失败");
        refresh();
        return;
      }
      await deleteQuestion(id);
      refresh();
    },
    [remote, refresh],
  );

  const loadDetail = useCallback(
    async (id: string): Promise<Question | null> => {
      if (!remote) {
        return mockQuestions.find((q) => q.id === id) ?? null;
      }
      try {
        const detail = await loadQuestion(id);
        const question = toFrontendQuestion(detail);
        // 附件的访问地址不在题目详情里：附件落在私有桶，地址要按附件单独取签名 URL。
        const attachments = await Promise.all(
          detail.attachments.map(async (attachment) => {
            try {
              const url = await getQuestionAttachmentUrl(id, attachment.id);
              return { ...attachment, url };
            } catch {
              return attachment;
            }
          }),
        );
        return { ...question, attachments };
      } catch {
        return null;
      }
    },
    [remote, mockQuestions],
  );

  const save = useCallback(
    async (question: Question): Promise<Question> => {
      if (!remote) {
        const result = upsertQuestion({ ...question, stem: question.stem });
        if (!result.ok || !result.question) {
          throw new Error(result.message ?? "保存失败");
        }
        refresh();
        return result.question;
      }

      const objective =
        question.type === "single" || question.type === "multi" || question.type === "judge";
      const options = objective
        ? (question.options ?? []).map((option) => ({
            key: option.key,
            text: option.text,
            isCorrect: (question.answer ?? []).includes(option.key),
          }))
        : undefined;
      const keypoints =
        question.type === "short"
          ? (question.keypoints ?? []).map((kp) => ({ text: kp.text, keywords: kp.keywords }))
          : undefined;
      const steps =
        question.type === "comprehensive"
          ? (question.steps ?? []).map((step) => ({
              code: step.id,
              prompt: step.prompt,
              referenceAnswer: step.answer,
              keywords: step.keywords,
              score: step.score,
            }))
          : undefined;

      // 难度标签：题目必须挂一个难度维度的标签。
      const difficultyTagId = resolveDifficultyTagId(question, catalogTags);

      const payload = {
        code: question.code ?? question.id,
        type: question.type,
        stem: question.stem,
        defaultScore: question.score,
        tagIds: question.tags,
        difficultyTagId,
        options,
        keypoints,
        steps,
        analysis: question.analysis,
        referenceAnswer: question.reference ?? "",
      };

      const detail: AdminQuestionDetail = question.id
        ? await updateQuestion(question.id, payload)
        : await createQuestion(payload);
      refresh();
      return toFrontendQuestion(detail);
    },
    [remote, refresh, catalogTags],
  );

  return {
    questions: remote ? remoteQuestions : mockRows,
    total: remote ? total : mockRows.length,
    loading,
    refresh,
    setStatus,
    batchStatus,
    remove,
    discardMany,
    loadDetail,
    save,
  };
}

/**
 * 取难度标签 ID。
 *
 * 题目必须挂一个**难度维度**的标签（后端建题时必填）：
 * 题目上已选的难度标签优先；没有就退到目录里第一个难度标签（编辑器不单独收难度，
 * 难度由「难度」分组的标签决定）。
 */
function resolveDifficultyTagId(
  question: Question,
  catalogTags: Array<{ id: string; group: string }>,
): string {
  const onQuestion = question.tags.find(
    (tagId) => catalogTags.find((tag) => tag.id === tagId)?.group === "difficulty",
  );
  if (onQuestion) return onQuestion;
  const first = catalogTags.find((tag) => tag.group === "difficulty");
  return first?.id ?? "";
}

/** 题目类型是否客观题。 */
export function isObjectiveType(type: QuestionType): boolean {
  return type === "single" || type === "multi" || type === "judge";
}
