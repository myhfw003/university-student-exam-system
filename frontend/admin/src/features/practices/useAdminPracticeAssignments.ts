/* ==========================================================================
   知行测评 · 管理端练习开放单数据通路
   --------------------------------------------------------------------------
   开放单是**独立于练习卷**的聚合（后端 `PracticeAssignment`）：
   开放给谁、开放多久、当前是什么状态，都记在开放单上；
   次数上限 / 反馈时机 / 错题回流这些练习规则记在**练习卷**上。
   管理端这一页管的是前者。

   mock 与 HTTP 各一份实现，页面只认同一形状（`AdminPracticeAssignment`）。

   两处口径差异要注意（页面不知道，数据通路知道）：

   1. **范围 ID**：HTTP 模式是后端的数字主键（转成字符串给页面）；
      mock 模式是本地的组织标签 ID（`org-class-cs-2301` 这样的串）。
      两边都是「组织维度标签」，语义一致，只是 ID 写法不同。
   2. **学生可见性**：真实后端里学生读的是**开放单**，
      没有开放单的练习卷学生看不见；mock 模式的学生侧仍按练习卷自身的
      上架标记走（本地内容仓库里没有开放单这条链路）。
      开放单与学生的这条链路由真实后端上的 e2e 用例守着。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archivePracticeAssignment as archivePracticeAssignmentApi,
  createPracticeAssignment as createPracticeAssignmentApi,
  isBackendEnabled,
  loadOrgTags,
  loadPapers,
  loadPracticeAssignments,
  publishPracticeAssignment as publishPracticeAssignmentApi,
  updatePracticeAssignment as updatePracticeAssignmentApi,
} from "@exam/shared/api";
import {
  PRACTICE_ASSIGNMENT_STATUS_LABEL,
  type AdminPracticeAssignment,
  type PracticeAssignmentStatus,
} from "@exam/shared/domain/practice";
import {
  archivePracticeAssignment,
  createPracticeAssignment,
  publishPracticeAssignment,
  updatePracticeAssignment,
  useAdminOps,
  type MockPracticeAssignment,
} from "@exam/shared/mock/adminOps";
import { useCatalog } from "@exam/shared/mock/catalog";
import type { Practice } from "@exam/shared/domain/types";

/** 列表的过滤与分页条件。 */
export interface PracticeAssignmentFilter {
  /** 状态过滤；`all` 表示全部。 */
  status: "all" | PracticeAssignmentStatus;
  /** 标题关键词。 */
  keyword: string;
  /** 页码（1 起）。 */
  page: number;
  /** 每页条数。 */
  size: number;
}

/** 可挂开放单的练习卷。 */
export interface PracticePaperOption {
  id: string;
  name: string;
  /** 题量。 */
  questionCount: number;
  /** 总分。 */
  totalScore: number;
}

/** 开放范围用的组织维度标签。 */
export interface ScopeTagOption {
  id: string;
  name: string;
}

/** 开放单的表单内容。 */
export interface PracticeAssignmentInput {
  /** 标题。 */
  title: string;
  /** 挂的练习卷（只在新建时用；后端的更新接口不能换卷）。 */
  paperId: string;
  /** 开放范围：组织维度标签 ID。 */
  scopeTagIds: string[];
  /** 开放开始时间（ISO）；null 表示不限。 */
  openAt: string | null;
  /** 开放结束时间（ISO）；null 表示不限。 */
  closeAt: string | null;
}

/* -------------------------------------------------------------- mock 行 */

/** mock 的开放单 → 页面的一行。 */
function toMockRow(
  assignment: MockPracticeAssignment,
  practice: Practice | undefined,
  attemptCount: number,
): AdminPracticeAssignment {
  const orgTags = useAdminOps.getState().orgTags;
  const nameOf = (tagId: string) => orgTags.find((tag) => tag.id === tagId)?.name ?? tagId;
  return {
    id: assignment.id,
    title: assignment.title,
    paperId: assignment.paperId,
    paperName: practice?.name ?? assignment.paperId,
    questionCount: practice?.items.length ?? 0,
    totalScore: practice?.totalScore ?? 0,
    status: assignment.status,
    statusLabel: PRACTICE_ASSIGNMENT_STATUS_LABEL[assignment.status],
    scopeTagIds: [...assignment.scope],
    scopeTagNames: assignment.scope.map(nameOf),
    openAt: assignment.openAt,
    closeAt: assignment.closeAt,
    publishedAt: assignment.publishedAt,
    createdAt: assignment.createdAt,
    attemptCount,
  };
}

/* -------------------------------------------------------------- 列表 */

/**
 * 开放单列表。
 *
 * HTTP 模式把状态与关键词**交给服务端**过滤（后端的列表接口支持这两个条件），
 * mock 模式在前端这一页里筛。
 */
export function useAdminPracticeAssignmentList(filter: PracticeAssignmentFilter): {
  rows: AdminPracticeAssignment[];
  total: number;
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockAssignments = useAdminOps((state) => state.practiceAssignments);
  const mockPractices = useCatalog((state) => state.practices);
  const mockResults = useCatalog((state) => state.practiceResults);

  const [rows, setRows] = useState<AdminPracticeAssignment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const page = await loadPracticeAssignments({
          keyword: filter.keyword.trim() || undefined,
          status: filter.status === "all" ? undefined : filter.status,
          page: filter.page,
          size: filter.size,
        });
        if (cancelled) return;
        setRows(page.items);
        setTotal(page.total);
      } catch {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, filter.keyword, filter.status, filter.page, filter.size, token]);

  // mock 模式：先筛出全部命中的，再按页切。
  const mockFiltered = useMemo<AdminPracticeAssignment[]>(() => {
    if (remote) return [];
    const keyword = filter.keyword.trim().toLowerCase();
    return mockAssignments
      .filter((assignment) => {
        if (filter.status !== "all" && assignment.status !== filter.status) return false;
        if (keyword && !assignment.title.toLowerCase().includes(keyword)) return false;
        return true;
      })
      // 后端按创建时间倒序排，mock 对齐。
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((assignment) => {
        const practice = mockPractices.find((p) => p.id === assignment.paperId);
        // 作答次数：这份练习卷上累计的提交次数。
        const attemptCount = Object.values(mockResults)
          .filter((result) => result.practiceId === assignment.paperId)
          .reduce((sum, result) => sum + (result.attempts || 0), 0);
        return toMockRow(assignment, practice, attemptCount);
      });
  }, [remote, mockAssignments, mockPractices, mockResults, filter.status, filter.keyword]);

  const mockRows = useMemo(() => {
    const start = (filter.page - 1) * filter.size;
    return mockFiltered.slice(start, start + filter.size);
  }, [mockFiltered, filter.page, filter.size]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    rows: remote ? rows : mockRows,
    total: remote ? total : mockFiltered.length,
    loading,
    refresh,
  };
}

/* ---------------------------------------------------------- 练习卷选项 */

/**
 * 可挂开放单的练习卷。
 *
 * **只列已发布的**：没发布的练习卷没有卷面快照，学生点了也做不了
 * （后端作答时会报「练习试卷还没有发布快照。」）。
 */
export function useAdminPracticePapers(): {
  papers: PracticePaperOption[];
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockPractices = useCatalog((state) => state.practices);

  const [papers, setPapers] = useState<PracticePaperOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const list = await loadPapers({ kind: "practice", status: "published", size: 100 });
        if (cancelled) return;
        setPapers(
          list.items.map((paper) => ({
            id: paper.id,
            name: paper.name,
            questionCount: paper.itemCount,
            totalScore: paper.totalItemScore,
          })),
        );
      } catch {
        if (!cancelled) setPapers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockPapers = useMemo<PracticePaperOption[]>(
    () =>
      mockPractices
        .filter((practice) => practice.status === "published")
        .map((practice) => ({
          id: practice.id,
          name: practice.name,
          questionCount: practice.items.length,
          totalScore: practice.totalScore,
        })),
    [mockPractices],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { papers: remote ? papers : mockPapers, loading, refresh };
}

/* ---------------------------------------------------------- 开放范围 */

/** 开放范围用的组织维度标签（院系 → 专业 → 班级）。 */
export function usePracticeScopeTags(): { tags: ScopeTagOption[] } {
  const remote = isBackendEnabled();
  const mockOrgTags = useAdminOps((state) => state.orgTags);

  const [tags, setTags] = useState<ScopeTagOption[]>([]);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;

    void (async () => {
      const list = await loadOrgTags().catch(() => []);
      if (cancelled) return;
      setTags(list.map((tag) => ({ id: tag.id, name: tag.name })));
    })();

    return () => {
      cancelled = true;
    };
  }, [remote]);

  const mockTags = useMemo<ScopeTagOption[]>(
    () => mockOrgTags.map((tag) => ({ id: tag.id, name: tag.name })),
    [mockOrgTags],
  );

  return { tags: remote ? tags : mockTags };
}

/* -------------------------------------------------------------- 动作 */

/** 把异常转成一句人话。 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 新建开放单（草稿）。 */
export async function submitPracticeAssignment(
  input: PracticeAssignmentInput,
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = createPracticeAssignment({
      title: input.title,
      paperId: input.paperId,
      scope: input.scopeTagIds,
      openAt: input.openAt,
      closeAt: input.closeAt,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "创建失败" };
  }

  try {
    await createPracticeAssignmentApi({
      paperId: input.paperId,
      title: input.title,
      scopeTagIds: input.scopeTagIds,
      openAt: input.openAt,
      closeAt: input.closeAt,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "创建失败") };
  }
}

/** 改开放单设置（标题、开放范围、开放期）。 */
export async function savePracticeAssignment(
  id: string,
  input: Omit<PracticeAssignmentInput, "paperId">,
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = updatePracticeAssignment(id, {
      title: input.title,
      scope: input.scopeTagIds,
      openAt: input.openAt,
      closeAt: input.closeAt,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "保存失败" };
  }

  try {
    await updatePracticeAssignmentApi(id, {
      title: input.title,
      scopeTagIds: input.scopeTagIds,
      openAt: input.openAt,
      closeAt: input.closeAt,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "保存失败") };
  }
}

/** 上架开放单。 */
export async function publishPracticeAssignmentById(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = publishPracticeAssignment(id);
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "上架失败" };
  }

  try {
    await publishPracticeAssignmentApi(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "上架失败") };
  }
}

/** 下架开放单。 */
export async function archivePracticeAssignmentById(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = archivePracticeAssignment(id);
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "下架失败" };
  }

  try {
    await archivePracticeAssignmentApi(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "下架失败") };
  }
}
