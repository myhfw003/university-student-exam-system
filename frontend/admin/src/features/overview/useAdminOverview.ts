/* ==========================================================================
   知行测评 · 管理端概览（看板拼装）的数据通路
   --------------------------------------------------------------------------
   概览是**看板**：后端没有「管理端仪表盘」这一个端点，数字由各资源自己数，
   前端拼起来（FR-CAT-08 / FR-ANA-01 的同一口径）。

   一处口径要注意：**发布校验未通过**要逐卷调校验端点才知道——
   列表接口不给校验结果。这里只对**草稿**卷做校验（已发布的卷不再校验）。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  countUsers,
  isBackendEnabled,
  loadAdminSessions,
  loadBanks,
  loadImportBatches,
  loadPaperTemplates,
  loadPapers,
  loadQuestions,
  loadReviewCounts,
  validatePaper,
} from "@exam/shared/api";
import type { PaperMode } from "@exam/shared/domain/types";
import { useAdminOps } from "@exam/shared/mock/adminOps";
import { preflight, useCatalog } from "@exam/shared/mock/catalog";

/** 发布校验未通过的卷。 */
export interface BlockedPaper {
  kind: "exam" | "practice";
  id: string;
  name: string;
}

/** 卷型模板（mock 与 HTTP 同一形状）。 */
export interface OverviewTemplate {
  id: string;
  name: string;
  /** `exam` / `practice`。 */
  kind: string;
  /** 卷型。 */
  mode: PaperMode;
  itemCount: number;
  durationMin: number;
}

/** 导入批次（mock 与 HTTP 同一形状）。 */
export interface OverviewImport {
  id: string;
  fileName: string;
  createdAt: string;
  rowCount: number;
  status: string;
}

/** 概览看板的数据。 */
export interface OverviewData {
  /** 题目总数。 */
  questionTotal: number;
  published: number;
  drafts: number;
  disabled: number;
  /** 题库数。 */
  bankCount: number;
  examCount: number;
  draftExams: number;
  practiceCount: number;
  draftPractices: number;
  /** 待阅卷份数。 */
  pendingReviews: number;
  sessionCount: number;
  ongoingSessions: number;
  userCount: number;
  /** 发布校验未通过的卷。 */
  blocked: BlockedPaper[];
  /** 卷型模板。 */
  templates: OverviewTemplate[];
  /** 最近导入批次。 */
  imports: OverviewImport[];
}

/** 空看板。 */
const EMPTY: OverviewData = {
  questionTotal: 0,
  published: 0,
  drafts: 0,
  disabled: 0,
  bankCount: 0,
  examCount: 0,
  draftExams: 0,
  practiceCount: 0,
  draftPractices: 0,
  pendingReviews: 0,
  sessionCount: 0,
  ongoingSessions: 0,
  userCount: 0,
  blocked: [],
  templates: [],
  imports: [],
};

/** 概览看板的数据通路。 */
export function useAdminOverview(): {
  data: OverviewData;
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();

  const mockQuestions = useCatalog((state) => state.questions);
  const mockExams = useCatalog((state) => state.exams);
  const mockPractices = useCatalog((state) => state.practices);
  const mockReviews = useCatalog((state) => state.reviews);
  const mockImports = useCatalog((state) => state.imports);
  const mockTemplates = useCatalog((state) => state.paperTemplates);
  const mockBanks = useCatalog((state) => state.banks);
  const mockSessions = useAdminOps((state) => state.sessions);
  const mockUsers = useAdminOps((state) => state.users);

  const [data, setData] = useState<OverviewData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [
          allQuestions,
          publishedQuestions,
          draftQuestions,
          disabledQuestions,
          banks,
          exams,
          practices,
          reviews,
          sessions,
          users,
          templates,
          imports,
        ] = await Promise.all([
          loadQuestions({ size: 1 }),
          loadQuestions({ status: "published", size: 1 }),
          loadQuestions({ status: "draft", size: 1 }),
          loadQuestions({ status: "disabled", size: 1 }),
          loadBanks(),
          loadPapers({ kind: "exam", size: 100 }),
          loadPapers({ kind: "practice", size: 100 }),
          loadReviewCounts().catch(() => null),
          loadAdminSessions({ status: "", keyword: "" }).catch(() => []),
          countUsers().catch(() => 0),
          loadPaperTemplates().catch(() => ({ items: [], total: 0 })),
          loadImportBatches({ size: 3 }).catch(() => ({ items: [], total: 0 })),
        ]);
        if (cancelled) return;

        // 发布校验未通过：只校验草稿卷（已发布的卷不再改动）。
        const drafts = [...exams.items, ...practices.items].filter(
          (paper) => paper.status === "draft",
        );
        const checks = await Promise.all(
          drafts.map((paper) =>
            validatePaper(paper.id)
              .then((result) => ({
                kind: (paper.kind === "practice" ? "practice" : "exam") as
                  | "exam"
                  | "practice",
                id: paper.id,
                name: paper.name,
                blocked: result.hasBlockingFailure,
              }))
              .catch(() => null),
          ),
        );

        if (cancelled) return;
        setData({
          questionTotal: allQuestions.total,
          published: publishedQuestions.total,
          drafts: draftQuestions.total,
          disabled: disabledQuestions.total,
          bankCount: banks.length,
          examCount: exams.total,
          draftExams: exams.items.filter((paper) => paper.status === "draft").length,
          practiceCount: practices.total,
          draftPractices: practices.items.filter((paper) => paper.status === "draft").length,
          pendingReviews: reviews?.pending ?? 0,
          sessionCount: sessions.length,
          ongoingSessions: sessions.filter((session) => session.status === "in_progress").length,
          userCount: users,
          blocked: checks
            .filter((check): check is NonNullable<typeof check> => Boolean(check?.blocked))
            .map(({ kind, id, name }) => ({ kind, id, name })),
          templates: templates.items.map((template) => ({
            id: template.id,
            name: template.name,
            kind: template.kind,
            mode:
              template.variantRule === "small_plum"
                ? "small"
                : template.variantRule === "large_plum"
                  ? "large"
                  : "standard",
            itemCount: template.itemCount,
            durationMin: template.durationMinutes,
          })),
          imports: imports.items.map((batch) => ({
            id: batch.id,
            fileName: batch.fileName,
            createdAt: batch.createdAt,
            rowCount: batch.totalRows,
            status: batch.status,
          })),
        });
      } catch {
        if (!cancelled) setData(EMPTY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockData = useMemo<OverviewData>(() => {
    const drafts = mockQuestions.filter((question) => question.status === "draft");
    const published = mockQuestions.filter((question) => question.status === "published");
    const disabled = mockQuestions.filter((question) => question.status === "disabled");
    const draftExams = mockExams.filter((exam) => exam.status === "draft" || !exam.published);
    const draftPractices = mockPractices.filter((practice) => practice.status !== "published");
    return {
      questionTotal: mockQuestions.length,
      published: published.length,
      drafts: drafts.length,
      disabled: disabled.length,
      bankCount: mockBanks.length,
      examCount: mockExams.length,
      draftExams: draftExams.length,
      practiceCount: mockPractices.length,
      draftPractices: draftPractices.length,
      pendingReviews: mockReviews.filter((review) => review.status === "pending").length,
      sessionCount: mockSessions.length,
      ongoingSessions: mockSessions.filter((session) => session.status === "in_progress").length,
      userCount: mockUsers.length,
      blocked: [
        ...mockExams
          .filter((exam) => !preflight("exam", exam.id).ok)
          .map((exam) => ({ kind: "exam" as const, id: exam.id, name: exam.name })),
        ...mockPractices
          .filter((practice) => !preflight("practice", practice.id).ok)
          .map((practice) => ({
            kind: "practice" as const,
            id: practice.id,
            name: practice.name,
          })),
      ],
      templates: mockTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        kind: template.kind,
        mode: template.mode === "fixed" ? "standard" : template.mode,
        itemCount: template.items.length,
        durationMin: template.durationMin,
      })),
      imports: mockImports.map((batch) => ({
        id: batch.id,
        fileName: batch.fileName,
        createdAt: batch.createdAt,
        rowCount: batch.rowCount,
        status: batch.status,
      })),
    };
  }, [
    mockQuestions,
    mockExams,
    mockPractices,
    mockReviews,
    mockImports,
    mockTemplates,
    mockBanks,
    mockSessions,
    mockUsers,
  ]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { data: remote ? data : mockData, loading, refresh };
}
