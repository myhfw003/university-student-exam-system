/* ==========================================================================
   知行测评 · 管理端组卷向导（四步）
   --------------------------------------------------------------------------
   对应原型 admin.paper。步骤：
     基本信息 → 选题与配分 → 卷型与梅花卷 → 名单与发布

   与原型的差异：**新增「一键出卷」**（docs/design/03-domain-model.md §4.2）。
   原型只能手工勾选 + 套模板；本实现按配额矩阵确定性抽题，池量不足即报错并
   列出缺口（不静默降级），生成后仍可手工微调。

   数据通路见 `useAdminPapers.ts`。真实后端模式下的三处差别：
   1. **名单与开放时间不在试卷上**——它们属于**场次**（`/exam-sessions`），
      向导里不再提供这两个输入。
   2. **发布校验在服务端**：`POST /papers/{id}/validate` 给逐项结果，
      警告项要填写覆盖理由才能发布（服务端只收一段总理由）。
   3. **卷面预览用服务端的派生卷面**：只有已发布的试卷才有可预览的卷面。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  Field,
  PageHead,
  SearchInput,
  Segmented,
  SelectInput,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import {
  applyPaperTemplate,
  createPaper as createRemotePaper,
  createPaperTemplate,
  generateBlueprint,
  isBackendEnabled,
  loadPaperTemplates,
  previewPaper,
  saveBlueprint,
  validatePaper,
  type AdminPaperTemplate,
  type PaperValidation,
  type PaperVariant,
} from "@exam/shared/api";
import {
  TAG_GROUP_ORDER,
  className as classNameOf,
  createExam,
  createPractice,
  difficultyLevels,
  getQuestion,
  preflight,
  publishedQuestionIds,
  savePaperTemplate,
  setExamMeta,
  setPaperItems,
  setPlumCfg,
  setPracticeMeta,
  useCatalog,
} from "@exam/shared/mock/catalog";
import {
  InsufficientQuestionPoolError,
  PAPER_MODES,
  autoSeed,
  buildPaper,
  canonicalOrder,
  selectQuestions,
  type BlueprintRules,
} from "@exam/shared/engine";
import type { ExamPaper, PaperItem, Practice, Question } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { DifficultyChip, TypeBadge } from "../shared/bits";
import { EntityTagsDialog } from "../shared/EntityTagsDialog";
import { scopeLabel, sumScore } from "../shared/scope";
import { PaperPreviewTable } from "../shared/PaperPreviewTable";
import { PaperVariantTable } from "../shared/PaperVariantTable";
import { MultiSelect } from "../shared/MultiSelect";
import { useCatalogTags } from "../shared/useCatalogTags";
import {
  useAdminPaper,
  usePaperQuestionPool,
  usePickedQuestions,
} from "./useAdminPapers";

/** 向导步骤。 */
type Step = "basic" | "select" | "plum" | "publish";

/** 向导步骤定义。考试与练习各一套（原型 admin-workbench.js:55-68 WIZ_STEPS）。 */
const STEPS: Record<"exam" | "practice", Array<{ key: Step; label: string; hint: string }>> = {
  exam: [
    { key: "basic", label: "基本信息", hint: "名称、时长与分值" },
    { key: "select", label: "选题与配分", hint: "选题并设定每题分值" },
    { key: "plum", label: "卷型与梅花卷", hint: "标准 / 小梅花 / 大梅花" },
    { key: "publish", label: "名单与发布", hint: "考试名单与发布校验" },
  ],
  practice: [
    { key: "basic", label: "基本信息", hint: "开放范围与练习规则" },
    { key: "select", label: "选题与配分", hint: "选题并设定每题分值" },
    { key: "plum", label: "卷型与规则", hint: "固定顺序组卷" },
    { key: "publish", label: "开放与上架", hint: "上架校验" },
  ],
};

/**
 * 题序规则定义。原型 shared/js/catalog.js:922-933 ORDER_RULES
 * （shared 层未导出该表，admin 层按原型逐字落地）。
 */
const ORDER_RULES = [
  {
    id: "type" as const,
    label: "按题型分块",
    desc: "单选 → 多选 → 判断 → 简答 → 综合操作；同一题型内按难度从基础到较难排列。",
  },
  {
    id: "manual" as const,
    label: "按选题顺序",
    desc: "保持组卷时的勾选顺序，不再自动重排题序。",
  },
];

/** 卷型卡说明（原型 admin-workbench.js:1048-1050，非 engine 的长文案）。 */
const MODE_CARDS: Array<{ id: "standard" | "small" | "large"; label: string; desc: string }> = [
  {
    id: "standard",
    label: "标准卷",
    desc: "全体答题者同一份卷面：题序按题型分块、组内由易到难，选项顺序固定。",
  },
  {
    id: "small",
    label: "小梅花",
    desc: "题目顺序全体统一保留，仅每位答题者的选项顺序独立打乱。",
  },
  {
    id: "large",
    label: "大梅花",
    desc: "保留题型分块的先后顺序（单选→多选→判断→简答→综合），每个题型内部的题目顺序按答题者独立打乱，选项顺序同样独立打乱。",
  },
];

/** 卷面粒度说明（原型 admin.js:424-429 grainText）。 */
const GRAIN_TEXT: Record<"standard" | "small" | "large", string> = {
  standard: "标准卷：全体答题者同一份卷面（题序与选项顺序均固定）",
  small: "小梅花：题序统一保留，仅每位答题者的选项顺序打乱",
  large: "大梅花：题型分块顺序保留（单选→多选→判断→简答→综合），每个题型内的题目顺序与选项顺序逐人打乱",
};

const QUESTION_TYPE_OPTIONS = [
  { value: "single", label: "单选题" },
  { value: "multi", label: "多选题" },
  { value: "judge", label: "判断题" },
  { value: "short", label: "简答题" },
  { value: "comprehensive", label: "综合操作题" },
];

/** 发布校验的展示口径（mock 与 HTTP 同一形状）。 */
interface CheckView {
  ok: boolean;
  total: number;
  failed: number;
  warnings: number;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail: string;
    level: "error" | "warning";
  }>;
}

/** 服务端校验结果 → 展示口径。 */
function toCheckView(validation: PaperValidation): CheckView {
  const checks = validation.items.map((item) => ({
    key: item.key,
    label: item.label,
    ok: item.passed,
    detail: item.detail,
    level: (item.severity === "warning" ? "warning" : "error") as "error" | "warning",
  }));
  const failed = checks.filter((c) => !c.ok && c.level === "error").length;
  const warnings = checks.filter((c) => !c.ok && c.level === "warning").length;
  return { ok: failed === 0, total: checks.length, failed, warnings, checks };
}

/** 组卷向导。 */
export function PaperWizardPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const remote = isBackendEnabled();
  const kind = (params.get("kind") as "exam" | "practice") || "exam";
  const step = (params.get("step") as Step) || "basic";

  // 标签目录（HTTP 模式来自服务端）。
  const { tags: catalogTags } = useCatalogTags();

  // mock 模式的数据源。
  const mockExams = useCatalog((state) => state.exams);
  const mockPractices = useCatalog((state) => state.practices);
  const mockQuestions = useCatalog((state) => state.questions);
  const mockBanks = useCatalog((state) => state.banks);
  const mockClasses = useCatalog((state) => state.classes);
  const mockTemplates = useCatalog((state) => state.paperTemplates);

  const {
    paper,
    loading: paperLoading,
    refresh: refreshPaper,
    saveMeta,
    setItems,
    setMode: saveMode,
    publish: publishRemote,
    unpublish: unpublishRemote,
  } = useAdminPaper(paperId);

  // 新建：先落库再跳转，避免向导里出现「没有对象」的中间态。
  useEffect(() => {
    if (paperId !== "new") return;
    let cancelled = false;
    void (async () => {
      try {
        let id: string | undefined;
        if (remote) {
          const created = await createRemotePaper({
            kind,
            name: kind === "exam" ? "未命名试卷" : "未命名练习",
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
          id = created.paper.id;
        } else {
          // 原型 admin-workbench.js:1492：对象名用「未命名试卷」，
          // 创建后提示「已创建试卷，请完善基本信息」。
          if (kind === "exam") {
            const result = createExam({ name: "未命名试卷", scope: [], orderRule: "type" });
            if (!result.ok || !result.exam) throw new Error(result.message ?? "创建失败");
            id = result.exam.id;
          } else {
            const result = createPractice({ name: "未命名练习", scope: [], orderRule: "type" });
            if (!result.ok || !result.practice) throw new Error(result.message ?? "创建失败");
            id = result.practice.id;
          }
        }
        if (!id || cancelled) return;
        toast.ok(kind === "exam" ? "已创建试卷，请完善基本信息" : "已创建练习，请完善基本信息");
        navigate(`/papers/${id}?kind=${kind}&step=basic`, { replace: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId, kind, navigate, remote]);

  /* ------------------------------------------------------- 基本信息表单 */

  const [name, setName] = useState("");
  const [batch, setBatch] = useState("");
  const [note, setNote] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [totalScore, setTotalScore] = useState(100);
  const [passScore, setPassScore] = useState(60);
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [allowRetake, setAllowRetake] = useState(false);
  const [publishAnswer, setPublishAnswer] = useState("after_close");
  const [repeats, setRepeats] = useState(0);
  const [feedback, setFeedback] = useState("after_submit");
  const [mistakeReflow, setMistakeReflow] = useState(true);
  const [orderRule, setOrderRule] = useState<"type" | "manual">("type");
  const [scope, setScope] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // 载入对象数据到表单。
  useEffect(() => {
    if (!paper || hydrated) return;
    setName(paper.name);
    setBatch(paper.batch);
    setNote(paper.note);
    setDurationMin(paper.durationMin || 60);
    setTotalScore(paper.targetTotalScore || 0);
    setPassScore(paper.passScore || 0);
    setAllowRetake(paper.allowRetake);
    setPublishAnswer(paper.publishAnswer);
    setRepeats(paper.repeats);
    setFeedback(paper.feedback);
    setMistakeReflow(paper.mistakeReflow);
    setOrderRule(paper.orderRule);
    setScope([...paper.scope]);
    if (!remote) {
      // mock 的考试卷另有开考 / 结束时间。
      const exam = mockExams.find((e) => e.id === paper.id);
      if (exam) {
        setOpenAt(exam.openAt ?? "");
        setCloseAt(exam.closeAt ?? "");
      }
    }
    setHydrated(true);
  }, [paper, hydrated, remote, mockExams]);

  /* ------------------------------------------------------- 选题筛选状态 */

  const [bankFilter, setBankFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  /* ------------------------------------------------------- 一键出卷状态 */

  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [bpTagIds, setBpTagIds] = useState<string[]>([]);
  const [bpTypeQuota, setBpTypeQuota] = useState<Record<string, number>>({});
  const [bpDifficultyQuota, setBpDifficultyQuota] = useState<Record<string, number>>({});
  const [bpTotal, setBpTotal] = useState(100);
  const [bpAllocation, setBpAllocation] = useState<"even" | "by_difficulty">("even");
  const [bpShortfall, setBpShortfall] = useState<string[]>([]);
  // 重新生成前的差异（FR-AUT-03：须二次确认并给出差异提示）。
  const [bpDiff, setBpDiff] = useState<{
    added: string[];
    removed: string[];
    changed: Array<{ qid: string; from: number; to: number }>;
    next: PaperItem[];
  } | null>(null);
  // 发布提醒项的覆盖理由（FR-AUT-06：可覆盖并填写理由）。
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});

  /* ------------------------------------------------------- 卷面预览状态 */

  const [previewStudent, setPreviewStudent] = useState("");
  /** HTTP 模式：服务端给的派生卷面。 */
  const [variant, setVariant] = useState<PaperVariant | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);

  /* ------------------------------------------------------- 实体标签弹窗 */

  // 向导页头的「标签」按钮（原型 admin-workbench.js:806）。
  const [tagTarget, setTagTarget] = useState<{
    kind: "exam" | "practice";
    id: string;
    name: string;
    tags: string[];
  } | null>(null);

  /* ------------------------------------------------------- 服务端数据 */

  const items = useMemo<PaperItem[]>(() => paper?.items ?? [], [paper]);
  const total = sumScore(items);

  /** 当前题序规则的说明文案（原型 ORDER_RULES desc）。 */
  const orderRuleMeta =
    ORDER_RULES.find((r) => r.id === orderRule) ?? ORDER_RULES[0]!;

  // 题目池：HTTP 模式在服务端筛。
  const pool = usePaperQuestionPool({
    bankIds: bankFilter,
    types: typeFilter,
    tagIds: tagFilter,
    keyword,
    enabled: step === "select" || step === "publish",
  });

  // 已选题目的详情（题库里可能翻不到已选的题）。
  const pickedIds = useMemo(() => items.map((i) => i.qid), [items]);
  const pickedDetails = usePickedQuestions(pickedIds);

  const filtered = useMemo(
    () => pool.questions.filter((question) => !pickedIds.includes(question.id)),
    [pool.questions, pickedIds],
  );

  // 多选筛选项：题库带已发布题数，题型带可选题数（原型 admin-workbench.js:940-946）。
  const bankFilterItems = useMemo(() => {
    if (remote) {
      return mockBanks.map((b) => ({ value: b.id, label: b.name, meta: "" }));
    }
    const publishedByBank = new Map<string, number>();
    for (const q of mockQuestions) {
      if (q.status !== "published") continue;
      for (const b of mockBanks) {
        if (!b.questionIds.includes(q.id)) continue;
        publishedByBank.set(b.id, (publishedByBank.get(b.id) ?? 0) + 1);
      }
    }
    return mockBanks.map((b) => ({
      value: b.id,
      label: b.name,
      meta: `${publishedByBank.get(b.id) ?? 0} 题`,
    }));
  }, [remote, mockBanks, mockQuestions]);

  const typeFilterItems = useMemo(
    () =>
      QUESTION_TYPE_OPTIONS.map((t) => ({
        value: t.value,
        label: t.label,
        meta: remote ? "" : `${pool.questions.filter((q) => q.type === t.value).length} 题`,
      })),
    [pool.questions, remote],
  );

  const pickedList = useMemo(() => {
    if (!paper) return [];
    // mock：题序按规则重排（原型 canonicalOrder）。
    const order = remote
      ? items.map((item) => item.qid)
      : (() => {
          const mockItem =
            kind === "exam"
              ? mockExams.find((e) => e.id === paper.id)
              : mockPractices.find((p) => p.id === paper.id);
          return mockItem
            ? canonicalOrder(mockItem, getQuestion, difficultyLevels())
            : items.map((item) => item.qid);
        })();
    const byQid = new Map(items.map((i) => [i.qid, i]));
    return order.map((qid, index) => {
      const picked = byQid.get(qid) ?? { qid, score: 0 };
      const detail = pickedDetails[qid];
      return {
        ...picked,
        index: index + 1,
        question: detail
          ? ({
              id: detail.id,
              code: detail.code,
              stem: detail.stem,
              type: detail.type,
              score: detail.score,
              tags: detail.tagIds,
            } as Question)
          : undefined,
      };
    });
  }, [paper, items, pickedDetails, remote, kind, mockExams, mockPractices]);

  /* ------------------------------------------------------- 模板（服务端） */

  const [remoteTemplates, setRemoteTemplates] = useState<AdminPaperTemplate[]>([]);

  const paperIdOfPaper = paper?.id ?? "";
  useEffect(() => {
    if (!remote || !paperIdOfPaper) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await loadPaperTemplates({ kind });
        if (!cancelled) setRemoteTemplates(page.items);
      } catch {
        if (!cancelled) setRemoteTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, kind, paperIdOfPaper]);

  const templates = useMemo(() => {
    if (remote) {
      return remoteTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        mode: t.variantRule,
        items: new Array(t.itemCount).fill(null),
      }));
    }
    return mockTemplates.filter((t) => t.kind === kind);
  }, [remote, remoteTemplates, mockTemplates, kind]);

  /* ------------------------------------------------------------ 动作 */

  const goStep = (next: Step) => {
    // 离开第 4 步时回写考试设置（原型 admin-workbench.js:1534-1537）。
    if (step === "publish" && next !== "publish") {
      void savePublishSettings();
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("kind", kind);
    nextParams.set("step", next);
    setParams(nextParams);
  };

  const saveBasic = async () => {
    if (!paper) return;
    try {
      if (remote) {
        await saveMeta({
          name,
          batch,
          note,
          durationMin,
          targetTotalScore: totalScore,
          passScore,
          orderRule,
          publishAnswer: publishAnswer as "after_close" | "after_submit" | "on_open",
          allowRetake,
          repeats,
          feedback: feedback as "after_submit" | "immediate",
          mistakeReflow,
        });
      } else if (kind === "exam") {
        const ok = setExamMeta(paper.id, {
          name,
          batch,
          note,
          durationMin,
          totalScore,
          passScore,
          openAt,
          closeAt,
          allowRetake,
          publishAnswer: publishAnswer as ExamPaper["publishAnswer"],
          scope,
          orderRule,
        }).ok;
        if (!ok) {
          toast.error("保存失败");
          return;
        }
      } else {
        const ok = setPracticeMeta(paper.id, {
          name,
          note,
          durationMin,
          scope,
          repeats,
          feedback: feedback as Practice["feedback"],
          mistakeReflow,
          orderRule,
        }).ok;
        if (!ok) {
          toast.error("保存失败");
          return;
        }
      }
      toast.ok("基本信息已保存");
      goStep("select");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const togglePick = async (qid: string) => {
    if (!paper) return;
    const next: PaperItem[] = items.some((i) => i.qid === qid)
      ? items.filter((i) => i.qid !== qid)
      : [...items, { qid, score: pickedDetails[qid]?.score ?? 5 }];
    try {
      await setItems(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const setScore = async (qid: string, score: number) => {
    if (!paper) return;
    const next = items.map((i) => (i.qid === qid ? { ...i, score } : i));
    try {
      await setItems(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const removePick = async (qid: string) => {
    if (!paper) return;
    try {
      await setItems(items.filter((i) => i.qid !== qid));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  /** 按题量均分：余数逐个补齐，总和精确等于目标（原型 admin-workbench.js:1215-1222）。 */
  const evenScores = async () => {
    if (!paper || items.length === 0) {
      toast.error("请先选择题目");
      return;
    }
    const target = totalScore || total;
    const base = Math.floor(target / items.length);
    const rem = target - base * items.length;
    try {
      await setItems(items.map((it, index) => ({ qid: it.qid, score: base + (index < rem ? 1 : 0) })));
      toast.ok(`已按 ${items.length} 题均分为 ${base} 分`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  /** 对齐目标总分：余数逐项补齐，总和精确等于目标。 */
  const alignScores = async () => {
    if (!paper || items.length === 0) return;
    const target = totalScore || total;
    const out = items.map((it) => ({ qid: it.qid, score: Number(it.score) || 0 }));
    const sum = out.reduce((a, b) => a + b.score, 0);
    let diff = target - sum;
    let i = out.length - 1;
    let guard = 0;
    while (diff !== 0 && guard < 500) {
      const step = diff > 0 ? 1 : -1;
      if (out[i]!.score + step >= 0) {
        out[i]!.score += step;
        diff -= step;
      }
      i = (i - 1 + out.length) % out.length;
      guard += 1;
    }
    try {
      await setItems(out);
      toast.ok(`配分已对齐到 ${target} 分`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  /** 一键出卷：按配额矩阵确定性抽题（服务端抽题，前端只给规则）。 */
  const runBlueprint = async () => {
    if (!paper) return;
    const rules: BlueprintRules = {
      tagSelector: {
        tagIds: bpTagIds,
        includeChildren: false,
        matchMode: "any",
      },
      difficultyQuota: bpDifficultyQuota,
      typeQuota: bpTypeQuota as BlueprintRules["typeQuota"],
      targetTotalScore: bpTotal,
      orderRule,
      scoreAllocation: bpAllocation,
    };

    if (remote) {
      try {
        // 服务端抽题：先存规则，再生成方案。
        await saveBlueprint(paper.id, {
          seed: autoSeed(paper.id),
          rules: {
            tagIds: bpTagIds,
            includeDescendants: false,
            matchMode: "any",
            difficultyQuota: bpDifficultyQuota,
            typeQuota: bpTypeQuota,
            targetTotalScore: bpTotal,
            orderRule: orderRule === "manual" ? "manual" : "by_type",
            scoreAllocation: bpAllocation,
          },
        });
        const result = await generateBlueprint(paper.id);
        setBpShortfall([]);
        setBlueprintOpen(false);

        const next: PaperItem[] = result.items.map((item) => ({
          qid: item.questionId,
          score: item.score,
        }));
        const currentMap = new Map(items.map((i) => [i.qid, i.score]));
        const nextMap = new Map(next.map((i) => [i.qid, i.score]));
        const diff = {
          added: next.filter((i) => !currentMap.has(i.qid)).map((i) => i.qid),
          removed: items.filter((i) => !nextMap.has(i.qid)).map((i) => i.qid),
          changed: next
            .filter((i) => currentMap.has(i.qid) && currentMap.get(i.qid) !== i.score)
            .map((i) => ({ qid: i.qid, from: currentMap.get(i.qid) ?? 0, to: i.score })),
          next,
        };
        if (diff.added.length || diff.removed.length || diff.changed.length) {
          setBpDiff(diff);
          return;
        }
        await applyBlueprint(diff.next, result.totalScore);
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失败";
        // 题池不足：服务端逐条列出缺口。
        if (message.includes("题池") || message.includes("不足")) {
          setBpShortfall([message]);
          return;
        }
        toast.error(message);
      }
      return;
    }

    const pool2 = availableQuestions();
    const poolFiltered = pool2.filter((q) =>
      bpTagIds.length === 0 ? true : q.tags.some((t) => bpTagIds.includes(t)),
    );

    try {
      const result = selectQuestions(rules, poolFiltered, autoSeed(paper.id), difficultyLevels());
      // 与当前卷面比对：新增 / 移除 / 分值变化。
      const current = items;
      const currentMap = new Map(current.map((i) => [i.qid, i.score]));
      const nextMap = new Map(result.items.map((i) => [i.qid, i.score]));
      const diff = {
        added: result.items.filter((i) => !currentMap.has(i.qid)).map((i) => i.qid),
        removed: current.filter((i) => !nextMap.has(i.qid)).map((i) => i.qid),
        changed: result.items
          .filter((i) => currentMap.has(i.qid) && currentMap.get(i.qid) !== i.score)
          .map((i) => ({ qid: i.qid, from: currentMap.get(i.qid) ?? 0, to: i.score })),
        next: result.items,
      };

      setBpShortfall([]);
      setBlueprintOpen(false);

      // 有差异就二次确认，避免覆盖掉教师的手工微调。
      if (diff.added.length || diff.removed.length || diff.changed.length) {
        setBpDiff(diff);
        return;
      }
      await applyBlueprint(result.items, result.totalScore);
    } catch (error) {
      if (error instanceof InsufficientQuestionPoolError) {
        setBpShortfall(
          error.shortfalls.map(
            (s) => `${s.type} / ${s.difficulty}：需 ${s.required} 题，可用 ${s.available} 题`,
          ),
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : "生成失败");
    }
  };

  /** mock 模式的题池：一键出卷要按全部已发布题目抽。 */
  function availableQuestions(): Question[] {
    return publishedQuestionIds(mockQuestions.map((q) => q.id))
      .map((id) => getQuestion(id))
      .filter((q): q is NonNullable<typeof q> => Boolean(q));
  }

  /** 应用抽题结果。 */
  const applyBlueprint = async (next: PaperItem[], totalScoreValue?: number) => {
    if (!paper) return;
    try {
      await setItems(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return;
    }
    setBpDiff(null);
    toast.ok(
      totalScoreValue === undefined
        ? `已生成 ${next.length} 题`
        : `已生成 ${next.length} 题，合计 ${totalScoreValue} 分`,
    );
  };

  /** 套用卷型模板（FR-AUT-07：跳过已停用题目并提示）。 */
  const applyTemplate = async (templateId: string) => {
    if (!paper) return;
    if (remote) {
      try {
        const result = await applyPaperTemplate(templateId, paper.id);
        refreshPaper();
        toast.ok(
          result.skippedCount > 0
            ? `已套用模板，跳过 ${result.skippedCount} 道未发布题目`
            : `已套用模板，共 ${result.appliedCount} 道题`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "套用失败");
      }
      return;
    }
    const template = mockTemplates.find((t) => t.id === templateId);
    if (!template) return;
    // 已停用 / 非已发布的题目不进入卷面，但要明确告知跳过了哪些。
    const usable = template.items.filter((i) => getQuestion(i.qid)?.status === "published");
    const skipped = template.items.filter((i) => getQuestion(i.qid)?.status !== "published");
    if (usable.length === 0) {
      toast.error("模板中的题目均未发布，无法套用");
      return;
    }
    const result = setPaperItems(kind, paper.id, usable);
    if (!result.ok) {
      toast.error(result.message ?? "套用失败");
      return;
    }
    // 套用模板时同步卷型（原型 admin-workbench.js:1763-1765）。
    if (kind === "exam" && template.mode !== "fixed") {
      setPlumCfg(paper.id, { mode: template.mode });
    }
    toast.ok(
      skipped.length > 0
        ? `已套用模板「${template.name}」，跳过 ${skipped.length} 道未发布题目`
        : `已套用模板「${template.name}」`,
    );
  };

  const saveAsTemplate = async (templateName: string) => {
    if (!paper) return;
    // 原型 admin-workbench.js:1777 —— 空题库时先给出原型文案，不落到 shared 的通用报错。
    if (items.length === 0) {
      toast.error("请先选择题目再保存模板");
      return;
    }
    if (remote) {
      try {
        await createPaperTemplate({ paperId: paper.id, name: templateName });
        toast.ok(`已保存卷型模板「${templateName}」`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败");
      }
      return;
    }
    const result = savePaperTemplate({
      name: templateName,
      kind,
      mode: kind === "exam" ? plumModeOf(paper.id) : "fixed",
      durationMin,
      passScore: kind === "exam" ? passScore : 0,
      items,
    });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok(`已保存卷型模板「${templateName}」`);
  };

  /** mock 模式：当前卷型。 */
  function plumModeOf(id: string): "standard" | "small" | "large" {
    const item = mockExams.find((e) => e.id === id);
    return item ? (paper?.mode ?? "standard") : "standard";
  }

  const setMode = async (mode: "standard" | "small" | "large") => {
    if (!paper) return;
    try {
      await saveMode(mode);
      toast.ok(`卷型已切换为${PAPER_MODES[mode].label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  /* ------------------------------------------------------- 发布校验状态 */

  const [validation, setValidation] = useState<PaperValidation | null>(null);

  // 进入发布步骤时拉一次服务端校验。
  useEffect(() => {
    if (!remote || !paper || step !== "publish") return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await validatePaper(paper.id);
        if (!cancelled) setValidation(result);
      } catch {
        if (!cancelled) setValidation(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, paper?.id, step, paper]);

  const check: CheckView = useMemo(() => {
    if (remote) {
      return validation
        ? toCheckView(validation)
        : { ok: false, total: 0, failed: 0, warnings: 0, checks: [] };
    }
    const result = preflight(kind, paper?.id ?? "");
    return {
      ok: result.ok,
      total: result.total,
      failed: result.failed,
      warnings: result.warnings,
      checks: result.checks,
    };
  }, [remote, validation, kind, paper?.id]);

  const publish = async () => {
    if (!paper) return;
    if (remote) {
      try {
        const result = await validatePaper(paper.id);
        setValidation(result);
        const view = toCheckView(result);
        if (!view.ok) {
          toast.error(`仍有 ${view.failed} 项校验未通过，无法发布`);
          return;
        }
        const warnings = view.checks.filter((c) => !c.ok && c.level === "warning");
        if (warnings.length > 0) {
          setOverrideReasons({});
          setOverrideOpen(true);
          return;
        }
        await doPublish();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "发布失败");
      }
      return;
    }

    const result = preflight(kind, paper.id);
    if (!result.ok) {
      toast.error(`仍有 ${result.failed} 项校验未通过，无法发布`);
      return;
    }
    // 有提醒项且没写覆盖理由时，先要理由再发布（FR-AUT-06）。
    if (result.warnings > 0 && kind === "exam") {
      const existing = (mockExams.find((e) => e.id === paper.id) as ExamPaper | undefined)
        ?.overrideReasons ?? {};
      const missing = result.checks.filter(
        (c) => !c.ok && c.level === "warning" && !existing[c.key],
      );
      if (missing.length > 0) {
        setOverrideReasons({ ...existing });
        setOverrideOpen(true);
        return;
      }
    }
    await doPublish();
  };

  /** 回写第 4 步的考试设置（答案公布时机 / 补考策略）。 */
  const savePublishSettings = async (): Promise<boolean> => {
    if (!paper || kind !== "exam") return true;
    try {
      if (remote) {
        await saveMeta({
          publishAnswer: publishAnswer as "after_close" | "after_submit" | "on_open",
          allowRetake,
        });
        return true;
      }
      return setExamMeta(paper.id, {
        publishAnswer: publishAnswer as ExamPaper["publishAnswer"],
        allowRetake,
      }).ok;
    } catch {
      return false;
    }
  };

  const doPublish = async (reasons?: Record<string, string>) => {
    if (!paper) return;
    // 发布时回写第 4 步改动，避免丢失（原型 admin-workbench.js:1580-1583）。
    if (!(await savePublishSettings())) {
      toast.error("保存失败");
      return;
    }
    try {
      if (remote) {
        // 服务端的覆盖理由是一整段（审计里也是这么记的）。
        const reason = reasons
          ? Object.entries(reasons)
              .map(([key, text]) => {
                const label = check.checks.find((c) => c.key === key)?.label ?? key;
                return `${label}：${text}`;
              })
              .join("；")
          : undefined;
        await publishRemote(reason);
        setOverrideOpen(false);
        toast.ok(kind === "exam" ? "试卷已发布，答题端可见" : "练习已上架，答题端可见");
        return;
      }
      const ok =
        kind === "exam"
          ? setExamMeta(paper.id, {
              status: "ongoing",
              published: true,
              ...(reasons ? { overrideReasons: reasons } : {}),
            }).ok
          : setPracticeMeta(paper.id, { status: "published", published: true }).ok;
      if (!ok) {
        toast.error("发布失败");
        return;
      }
      setOverrideOpen(false);
      toast.ok(kind === "exam" ? "试卷已发布，答题端可见" : "练习已上架，答题端可见");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败");
    }
  };

  const unpublish = async () => {
    if (!paper) return;
    try {
      if (remote) {
        await unpublishRemote();
        toast.ok(kind === "exam" ? "试卷已撤回发布" : "练习已下架");
        return;
      }
      const ok =
        kind === "exam"
          ? setExamMeta(paper.id, { status: "draft", published: false }).ok
          : setPracticeMeta(paper.id, { status: "draft", published: false }).ok;
      if (!ok) {
        toast.error("撤回失败");
        return;
      }
      toast.ok(kind === "exam" ? "试卷已撤回发布" : "练习已下架");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "撤回失败");
    }
  };

  /** 取服务端给的派生卷面（HTTP 模式）。 */
  const loadVariant = async () => {
    if (!paper) return;
    setVariantError(null);
    try {
      const result = await previewPaper(paper.id, previewStudent || undefined);
      setVariant(result);
    } catch (error) {
      setVariant(null);
      setVariantError(error instanceof Error ? error.message : "卷面预览失败");
    }
  };

  // 进入卷型步骤时取一次卷面。
  useEffect(() => {
    if (!remote || step !== "plum" || !paper) return;
    void loadVariant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, step, paper?.id, previewStudent]);

  /* ------------------------------------------------------------ 渲染 */

  if (remote && paperLoading) {
    return <PageHead title={kind === "exam" ? "试卷" : "练习"} sub="正在载入…" />;
  }

  if (!paper) {
    return (
      <PageHead
        title={kind === "exam" ? "试卷" : "练习"}
        sub="对象不存在或已被删除。"
        actions={
          <Button variant="primary" onClick={() => navigate(`/papers?kind=${kind}`)}>
            返回列表
          </Button>
        }
      />
    );
  }

  const steps = STEPS[kind];
  const currentIndex = steps.findIndex((s) => s.key === step);
  const published = paper.published;
  const scopeStudents = useCatalog.getState().students.filter(
    (s) => scope.length === 0 || scope.includes(s.classId),
  );

  return (
    <>
      <PageHead
        title={paper.name}
        sub={`${kind === "exam" ? "考试卷" : "练习"} · ${paper.batch || paper.note || "尚未填写说明"} · 第 ${currentIndex + 1} / ${steps.length} 步`}
        actions={
          <>
            <Button onClick={() => navigate(`/papers?kind=${kind}`)}>返回列表</Button>
            <Button
              onClick={() =>
                setTagTarget({
                  kind,
                  id: paper.id,
                  name: paper.name,
                  tags: paper.tags,
                })
              }
            >
              标签
            </Button>
          </>
        }
      />

      <ol className="steps">
        {steps.map((s, index) => {
          const cls = s.key === step ? "is-current" : index < currentIndex ? "is-done" : "";
          return (
            <li className={`step ${cls}`} key={s.key}>
              <button
                type="button"
                className="step-btn"
                aria-current={s.key === step ? "step" : undefined}
                onClick={() => goStep(s.key)}
              >
                <span className="step-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="step-text">
                  <span className="step-label">{s.label}</span>
                  <span className="step-hint">{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* --------------------------------------------------- 第 1 步 */}
      {step === "basic" ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">基本信息</h2>
            <span className="text-sm text-3">
              {remote ? "名单与开放时间在场次里配置" : scopeLabel(scope, classNameOf)}
            </span>
          </div>
          <div className="card-body">
            <div className="grid-2">
              <Field label="名称" required htmlFor="wiz-name">
                <TextInput id="wiz-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {kind === "exam" ? (
                <Field label="考试批次" htmlFor="wiz-batch">
                  <TextInput
                    id="wiz-batch"
                    value={batch}
                    placeholder="例如 2026—2027 学年第一学期 · 期中考试"
                    onChange={(e) => setBatch(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="建议时长（分钟）" htmlFor="wiz-duration">
                  <TextInput
                    id="wiz-duration"
                    type="number"
                    min={1}
                    max={300}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
                  />
                </Field>
              )}
            </div>

            {kind === "exam" ? (
              <>
                <div className="grid-4" style={{ marginTop: "var(--sp-4)" }}>
                  <Field label="时长（分钟）" htmlFor="wiz-duration">
                    <TextInput
                      id="wiz-duration"
                      type="number"
                      min={1}
                      max={300}
                      value={durationMin}
                      onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="总分" htmlFor="wiz-total">
                    <TextInput
                      id="wiz-total"
                      type="number"
                      min={0}
                      max={200}
                      value={totalScore}
                      onChange={(e) => setTotalScore(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="及格分" htmlFor="wiz-pass">
                    <TextInput
                      id="wiz-pass"
                      type="number"
                      min={0}
                      max={200}
                      value={passScore}
                      onChange={(e) => setPassScore(Number(e.target.value) || 0)}
                    />
                  </Field>
                  {remote ? null : (
                    <Field label="开考时间" htmlFor="wiz-open">
                      <TextInput
                        id="wiz-open"
                        value={openAt}
                        placeholder="2026-11-09 08:30"
                        onChange={(e) => setOpenAt(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
                {remote ? null : (
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <Field label="结束时间" htmlFor="wiz-close">
                      <TextInput
                        id="wiz-close"
                        value={closeAt}
                        placeholder="2026-11-09 12:00"
                        onChange={(e) => setCloseAt(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </>
            ) : null}

            <div style={{ marginTop: "var(--sp-4)" }}>
              <Field label="说明" htmlFor="wiz-note">
                <TextArea
                  id="wiz-note"
                  value={note}
                  placeholder="面向答题者的说明与注意事项"
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>

            {kind === "practice" ? (
              <>
                <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
                  练习规则
                </h3>
                <div className="grid-2" style={{ marginTop: "var(--sp-3)" }}>
                  <Field label="可重复次数" hint="0 表示不限次数。" htmlFor="wiz-repeats">
                    <TextInput
                      id="wiz-repeats"
                      type="number"
                      min={0}
                      max={99}
                      value={repeats}
                      onChange={(e) => setRepeats(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="解析反馈时机" htmlFor="wiz-feedback">
                    <SelectInput
                      id="wiz-feedback"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    >
                      <option value="immediate">每题作答后即时反馈</option>
                      <option value="after_submit">提交后统一展示解析</option>
                    </SelectInput>
                  </Field>
                </div>
                <label className="checkline" style={{ marginTop: "var(--sp-4)" }}>
                  <input
                    type="checkbox"
                    id="wiz-mistake"
                    checked={mistakeReflow}
                    onChange={(e) => setMistakeReflow(e.target.checked)}
                  />
                  <span className="checkline-text">
                    错题自动回流至错题本
                    <span className="checkline-hint">
                      练习中答错的题目会进入答题者的错题本，用于后续专项复习。
                    </span>
                  </span>
                </label>
              </>
            ) : null}

            {remote ? (
              <>
                <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
                  {kind === "exam" ? "考试名单" : "开放范围"}
                </h3>
                <Callout icon={<Icon name="info" />} title="名单与开放时间在场次里配置">
                  真实后端的试卷只管内容：谁参加、什么时候开考、开放给谁，都属于**场次**
                  （考试场次 / 练习开放单）。在这里配置的是卷面本身。
                </Callout>
              </>
            ) : (
              <>
                <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
                  {kind === "exam" ? "考试名单" : "开放范围"}
                </h3>
                <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
                  {mockClasses.map((c) => {
                    const on = scope.includes(c.id);
                    const count = useCatalog
                      .getState()
                      .students.filter((s) => s.classId === c.id).length;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`chip${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() =>
                          setScope((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                          )
                        }
                      >
                        {c.name} · {count} 人
                      </button>
                    );
                  })}
                </div>
                <p className="section-note" style={{ marginTop: "var(--sp-2)" }}>
                  {kind === "exam"
                    ? "不选任何名单组即为全员开放。考试发布时名单会被物化。"
                    : "不选任何名单组即为全员开放。"}
                </p>
              </>
            )}
          </div>
          <div className="card-foot">
            <Button variant="primary" onClick={() => void saveBasic()}>
              保存并选择题目
            </Button>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- 第 2 步 */}
      {step === "select" ? (
        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">可选题目</h2>
              <span className="text-sm text-3">仅「已发布」题目可入选</span>
            </div>
            <div className="card-body">
              <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                <MultiSelect
                  title="题库"
                  allLabel="全部题库"
                  minWidth={170}
                  items={bankFilterItems}
                  selected={bankFilter}
                  onChange={setBankFilter}
                />
                <MultiSelect
                  title="题型"
                  allLabel="全部题型"
                  minWidth={150}
                  items={typeFilterItems}
                  selected={typeFilter}
                  onChange={setTypeFilter}
                />
                <SearchInput
                  label="搜索题号或题干"
                  value={keyword}
                  placeholder="搜索题号或题干"
                  onSearch={setKeyword}
                  onChange={setKeyword}
                />
              </div>
              <p className="section-note" style={{ margin: "-4px 0 var(--sp-3)" }}>
                题库与题型均可多选；未选择时表示不限制，命中任一所选项即列出。
              </p>
              <div className="filter-block">
                <div className="filter-group-label">标签筛选</div>
                <div className="row-tight">
                  {TAG_GROUP_ORDER.flatMap((group) =>
                    catalogTags
                      .filter((t) => t.group === group)
                      .map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`chip is-tag${tagFilter.includes(tag.id) ? " is-on" : ""}`}
                          aria-pressed={tagFilter.includes(tag.id)}
                          onClick={() =>
                            setTagFilter((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((x) => x !== tag.id)
                                : [...prev, tag.id],
                            )
                          }
                        >
                          {tag.name}
                        </button>
                      )),
                  )}
                </div>
              </div>
            </div>
            <div className="card-body is-flush">
              <div className="pick-list" style={{ maxHeight: 420 }}>
                {filtered.length === 0 ? (
                  <div className="empty">
                    <span className="empty-title">没有可用的已发布题目</span>
                    <span className="empty-body">请先在题库工作台发布题目。</span>
                  </div>
                ) : (
                  filtered.map((q) => (
                    <label className="pick-row has-meta" key={q.id}>
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => void togglePick(q.id)}
                      />
                      <span className="pick-id mono">{q.code || q.id}</span>
                      <span className="pick-text">{q.stem}</span>
                      <span className="text-xs text-3">{q.score} 分</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">已选题目</h2>
              <span className="text-sm text-3">
                合计 {total} / 目标 {totalScore} 分
              </span>
            </div>
            <div className="card-body">
              <Field
                htmlFor="wiz-order-rule"
                label="题序规则"
                hint={`${orderRuleMeta.desc} 下列序号是出卷的基础题序：标准卷与小梅花按此顺序出卷，大梅花保留题型分块顺序、仅在每个题型内部打乱题目。`}
              >
                <SelectInput
                  id="wiz-order-rule"
                  value={orderRule}
                  onChange={(e) => {
                    const next = e.target.value as "type" | "manual";
                    setOrderRule(next);
                    if (remote) {
                      void saveMeta({ orderRule: next });
                    } else if (kind === "exam") {
                      setExamMeta(paper.id, { orderRule: next });
                    } else {
                      setPracticeMeta(paper.id, { orderRule: next });
                    }
                    toast.ok(
                      next === "type"
                        ? "题序已按题型分块、组内由易到难排布"
                        : "题序已改为按选题顺序",
                    );
                  }}
                >
                  {ORDER_RULES.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <div className="row" style={{ margin: "var(--sp-3) 0" }}>
                <Button size="sm" onClick={() => void evenScores()}>
                  按题量均分
                </Button>
                <Button size="sm" onClick={() => void alignScores()}>
                  对齐目标总分
                </Button>
                <Button size="sm" variant="primary" onClick={() => setBlueprintOpen(true)}>
                  <Icon name="shuffle" />
                  一键出卷
                </Button>
              </div>

              <div className="wiz-picked">
                {pickedList.length === 0 ? (
                  <div className="empty">
                    <span className="empty-title">尚未选题</span>
                    <span className="empty-body">在左侧勾选题目，并为其设置分值。</span>
                  </div>
                ) : (
                  pickedList.map((p) => (
                    <div className="wiz-picked-row" key={p.qid}>
                      <span className="pick-id mono">{p.index}</span>
                      <div className="wiz-picked-main">
                        <span className="wiz-picked-stem">
                          {p.question?.stem ?? p.qid}
                        </span>
                        <span className="wiz-picked-meta">
                          {p.question ? <TypeBadge type={p.question.type} /> : null}
                          {p.question ? <DifficultyChip tags={p.question.tags} /> : null}
                        </span>
                      </div>
                      <TextInput
                        type="number"
                        min={0}
                        max={40}
                        value={p.score}
                        aria-label={`${p.qid} 分值`}
                        onChange={(e) => void setScore(p.qid, Number(e.target.value) || 0)}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`移除 ${p.qid}`}
                        onClick={() => void removePick(p.qid)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card-body" style={{ borderTop: "1px solid var(--c-border)" }}>
              <div className="row">
                {templates.length > 0 ? (
                  <>
                    <SelectInput
                      id="wiz-tpl"
                      aria-label="卷型模板"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void applyTemplate(e.target.value);
                      }}
                    >
                      <option value="">选择卷型模板…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}（{t.items.length} 题）
                        </option>
                      ))}
                    </SelectInput>
                  </>
                ) : (
                  <span className="text-sm text-3">暂无卷型模板，可将当前配分保存为模板。</span>
                )}
                <TextInput
                  id="wiz-tpl-name"
                  placeholder="模板名称"
                  aria-label="模板名称"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const input = document.getElementById("wiz-tpl-name") as HTMLInputElement | null;
                    const templateName = input?.value.trim() ?? "";
                    if (!templateName) {
                      toast.error("请填写模板名称");
                      return;
                    }
                    void saveAsTemplate(templateName);
                    if (input) input.value = "";
                  }}
                >
                  保存为模板
                </Button>
              </div>
            </div>
            <div className="card-foot">
              <Button variant="primary" onClick={() => goStep("plum")}>
                下一步 · 卷型
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {/* --------------------------------------------------- 第 3 步 */}
      {step === "plum" ? (
        <>
          {kind === "practice" ? (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">卷型与规则</h2>
              </div>
              <div className="card-body">
                <Callout icon={<Icon name="info" />} title="练习卷按固定顺序组卷">
                  练习卷面向单个答题者的巩固训练，题序按第 2 步选定的题序规则排布，选项顺序固定，不生成梅花卷变体；需要变式训练时可在题库中维护多套练习。
                </Callout>
                <dl className="kv" style={{ marginTop: "var(--sp-5)" }}>
                  <dt>题量</dt>
                  <dd>{items.length} 道</dd>
                  <dt>题序规则</dt>
                  <dd>{orderRuleMeta.label}</dd>
                  <dt>总分</dt>
                  <dd>{total} 分</dd>
                  <dt>时长</dt>
                  <dd>{durationMin} 分钟</dd>
                  <dt>开放范围</dt>
                  <dd>{remote ? "在练习开放单中配置" : scopeLabel(scope, classNameOf)}</dd>
                </dl>
              </div>
              <div className="card-foot">
                <Button variant="primary" onClick={() => goStep("publish")}>
                  下一步 · 上架
                </Button>
              </div>
            </section>
          ) : (
            <>
              <section className="card">
                <div className="card-head">
                  <h2 className="card-title">卷型与梅花卷</h2>
                  <span className="text-sm text-3">置换种子由系统自动生成</span>
                </div>
                <div className="card-body">
                  <div className="grid-3">
                    {MODE_CARDS.map((mode) => {
                      const on = paper.mode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          className={`mode-card${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => void setMode(mode.id)}
                        >
                          <span className="mode-name">{mode.label}</span>
                          <span className="mode-desc">{mode.desc}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid-2" style={{ marginTop: "var(--sp-5)" }}>
                    <div className="field">
                      <span className="field-label">题序规则</span>
                      <div className="text-sm text-3">
                        {orderRuleMeta.label}（第 2 步设定）
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">卷面生成方式</span>
                      <div className="text-sm text-3">
                        {paper.mode === "standard"
                          ? "固定卷面，全体一致"
                          : paper.mode === "small"
                            ? "题序统一，逐人打乱选项"
                            : "题型分块保留，组内题序与选项逐人打乱"}
                      </div>
                    </div>
                  </div>

                  <Callout icon={<Icon name="info" />} title="置换口径">
                    {paper.mode === "standard"
                      ? "标准卷不生成变体，全体答题者共用同一份卷面。"
                      : paper.mode === "small"
                        ? `当前名单 ${scopeStudents.length} 名答题者 → 共 ${scopeStudents.length} 种不同卷面（题序统一，仅选项顺序逐人打乱）。`
                        : `当前名单 ${scopeStudents.length} 名答题者 → 共 ${scopeStudents.length} 种不同卷面（题型分块顺序不变，组内题序与选项顺序逐人打乱）。`}{" "}
                    小梅花保留统一题序、仅逐人打乱选项；大梅花保留题型分块顺序（单选→多选→判断→简答→综合），仅在每个题型内部打乱题目顺序，选项也逐人打乱。{" "}
                    置换种子由系统按试卷自动生成，无需手工设置；同一试卷重复出卷结果一致，可随时复核。判断题固定不参与选项置换。
                  </Callout>
                  <div className="row" style={{ marginTop: "var(--sp-5)" }}>
                    <span className="text-sm text-3">
                      卷型选择即时生效并自动保存，可切换到「答题者卷面」预览逐人对照：标准卷完全一致，小梅花仅选项顺序不同，大梅花题型分块不变、组内题序与选项顺序均不同。
                    </span>
                  </div>
                </div>
              </section>

              <section className="card" style={{ marginTop: "var(--sp-4)" }}>
                <div className="card-head">
                  <h2 className="card-title">答题者卷面预览</h2>
                  {remote ? (
                    <TextInput
                      aria-label="答题者标识"
                      placeholder="答题者标识（学号）"
                      value={previewStudent}
                      onChange={(event) => setPreviewStudent(event.target.value)}
                    />
                  ) : (
                    <SelectInput
                      aria-label="选择答题者"
                      value={previewStudent}
                      onChange={(e) => setPreviewStudent(e.target.value)}
                    >
                      {scopeStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{classNameOf(s.classId)}）
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </div>
                <div className="card-body">
                  {items.length === 0 ? (
                    <div className="empty">
                      <span className="empty-title">尚未选题</span>
                      <span className="empty-body">先在第 2 步选题，再回到这里预览卷面。</span>
                    </div>
                  ) : remote ? (
                    variantError ? (
                      <Callout tone="warn" icon={<Icon name="alert" />} title="没有可预览的卷面">
                        {variantError}
                        {" "}
                        {published
                          ? "服务端只为已发布的试卷生成可预览的卷面。"
                          : "试卷还没有发布，服务端没有可预览的卷面——发布后可回到这里逐人对照。"}
                      </Callout>
                    ) : variant ? (
                      <>
                        <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                          <span className="variant-tag">{variant.ruleLabel}</span>
                          <span className="text-sm text-3">
                            卷面 {variant.ruleLabel} · 置换号 {variant.variantKey}
                          </span>
                          <span className="text-sm text-3">· {GRAIN_TEXT[paper.mode]}</span>
                        </div>
                        <PaperVariantTable variant={variant} />
                      </>
                    ) : (
                      <div className="empty">
                        <span className="empty-title">正在取卷面…</span>
                      </div>
                    )
                  ) : (
                    (() => {
                      const studentId = previewStudent || scopeStudents[0]?.id || "2023120101";
                      const built = buildPaper(
                        mockExams.find((e) => e.id === paper.id) as ExamPaper,
                        studentId,
                        undefined,
                        getQuestion,
                        difficultyLevels(),
                      );
                      return (
                        <>
                          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                            <span className="variant-tag">{built.variantLabel}</span>
                            <span className="text-sm text-3">
                              卷型 {PAPER_MODES[built.mode].label} · 置换号 {built.seedLabel}（系统自动生成）
                            </span>
                            <span className="text-sm text-3">· {GRAIN_TEXT[built.mode]}</span>
                          </div>
                          <PaperPreviewTable
                            paper={built}
                            showBase={built.mode === "large"}
                          />
                        </>
                      );
                    })()
                  )}
                </div>
              </section>

              <div className="card-foot" style={{ borderTop: "1px solid var(--c-border)" }}>
                <Button variant="primary" onClick={() => goStep("publish")}>
                  下一步 · 名单与发布
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}

      {/* --------------------------------------------------- 第 4 步 */}
      {step === "publish" ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{kind === "exam" ? "名单与发布" : "开放与上架"}</h2>
            <span className="text-sm text-3">{published ? "已发布" : "未发布"}</span>
          </div>
          <div className="card-body">
            {kind === "exam" ? (
              <>
                <h3 className="section-title">考试设置</h3>
                <div className="grid-2" style={{ marginTop: "var(--sp-3)" }}>
                  <Field
                    label="答案公布时机"
                    htmlFor="wiz-publish-answer"
                    hint="考试进行中任何人都读不到答案与解析；场次结束后才按这里的设置公布。练习卷在「练习设置」里按反馈时机公布。"
                  >
                    <SelectInput
                      id="wiz-publish-answer"
                      value={publishAnswer}
                      onChange={(e) => setPublishAnswer(e.target.value)}
                    >
                      <option value="after_close">结束后全员公布</option>
                      <option value="after_submit">结束后仅交卷者公布</option>
                      <option value="on_open">结束后立即公布</option>
                    </SelectInput>
                  </Field>
                  <div className="field">
                    <span className="field-label">补考策略</span>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        id="wiz-retake"
                        checked={allowRetake}
                        onChange={(e) => setAllowRetake(e.target.checked)}
                      />
                      <span className="checkline-text">
                        允许重考
                        <span className="checkline-hint">
                          开启后答题者可重复进入本场考试，成绩取最高分。
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
                <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
                  考试名单
                </h3>
                {remote ? (
                  <Callout icon={<Icon name="info" />} title="名单在场次里配置">
                    真实后端的试卷不带名单：参加考试的人由**考试场次**的名单决定
                    （考试场次 → 参与人）。发布试卷后到「场次」里指定名单与时间即可。
                  </Callout>
                ) : (
                  <>
                    <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
                      {mockClasses.map((c) => {
                        const on = scope.includes(c.id);
                        const count = useCatalog
                          .getState()
                          .students.filter((s) => s.classId === c.id).length;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`chip${on ? " is-on" : ""}`}
                            aria-pressed={on}
                            onClick={() => {
                              const next = scope.includes(c.id)
                                ? scope.filter((x) => x !== c.id)
                                : [...scope, c.id];
                              setScope(next);
                              setExamMeta(paper.id, { scope: next });
                            }}
                          >
                            {c.name} · {count} 人
                          </button>
                        );
                      })}
                    </div>
                    <p className="section-note" style={{ marginTop: "var(--sp-2)" }}>
                      当前覆盖 {scopeStudents.length} 名答题者；名单为空时不可发布。
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <h3 className="section-title">开放范围</h3>
                {remote ? (
                  <Callout icon={<Icon name="info" />} title="开放范围在练习开放单里配置">
                    真实后端的练习卷不带开放范围：开放给谁由**练习开放单**决定
                    （可按组织维度标签开放，或全员开放）。这份练习卷发布之后，
                    到「练习开放单」里建一张单子挂上去并上架，学生才看得到。
                    <div style={{ marginTop: "var(--sp-2)" }}>
                      <Button size="sm" onClick={() => navigate("/practices")}>
                        去练习开放单
                      </Button>
                    </div>
                  </Callout>
                ) : (
                  <>
                    <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
                      {mockClasses.map((c) => {
                        const on = scope.includes(c.id);
                        const count = useCatalog
                          .getState()
                          .students.filter((s) => s.classId === c.id).length;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`chip${on ? " is-on" : ""}`}
                            aria-pressed={on}
                            onClick={() => {
                              const next = scope.includes(c.id)
                                ? scope.filter((x) => x !== c.id)
                                : [...scope, c.id];
                              setScope(next);
                              setPracticeMeta(paper.id, { scope: next });
                            }}
                          >
                            {c.name} · {count} 人
                          </button>
                        );
                      })}
                    </div>
                    <p className="section-note" style={{ marginTop: "var(--sp-2)" }}>
                      不选名单组即为全员开放；上架后答题端可见。
                    </p>
                  </>
                )}
              </>
            )}

            <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
              发布前校验
            </h3>
            <div style={{ marginTop: "var(--sp-3)" }}>
              <ul className="checklist">
                {check.checks.map((c) => (
                  <li
                    className={`check-item ${c.ok ? "is-ok" : c.level === "warning" ? "" : "is-bad"}`}
                    key={c.key}
                  >
                    <span className="check-mark" aria-hidden="true">
                      <Icon name={c.ok ? "check" : c.level === "warning" ? "alert" : "close"} />
                    </span>
                    <span className="check-text">
                      <span className="check-label">{c.label}</span>
                      <span className="check-detail">{c.detail}</span>
                    </span>
                    <span className="check-state">
                      {c.ok ? "通过" : c.level === "warning" ? "警告" : "未通过"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                共 {check.total} 项检查，
                {check.failed
                  ? `其中 ${check.failed} 项未通过，需修正后才能发布。`
                  : check.warnings > 0
                    ? `其中 ${check.warnings} 项为提醒，发布时需填写覆盖理由。`
                    : "全部通过，可以发布。"}
              </p>
            </div>

            {!check.ok ? (
              <Callout tone="warn" icon={<Icon name="alert" />} title="存在未通过的校验项">
                请先修正上述问题，发布按钮在全部校验通过后才会启用。
              </Callout>
            ) : null}
          </div>
          <div className="card-foot">
            <Button onClick={() => goStep("plum")}>上一步 · 卷型</Button>{" "}
            {published ? (
              <Button onClick={() => void unpublish()}>
                {kind === "exam" ? "撤回发布" : "下架"}
              </Button>
            ) : (
              <Button variant="primary" disabled={!check.ok} onClick={() => void publish()}>
                {kind === "exam" ? "发布考试" : "上架练习"}
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- 一键出卷 */}
      <ConfirmDialog
        open={blueprintOpen}
        title="一键出卷"
        message={
          <div>
            <p className="text-2">
              按配额矩阵从已发布题库中确定性抽题。题池不足时会**列出缺口并报错**，不做静默降级。
            </p>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <Field label="目标总分" htmlFor="bp-total">
                <TextInput
                  id="bp-total"
                  type="number"
                  min={0}
                  value={bpTotal}
                  onChange={(e) => setBpTotal(Number(e.target.value) || 0)}
                />
              </Field>
              <div style={{ marginTop: "var(--sp-3)" }}>
                <Field label="分值分配方式">
                  <Segmented
                    label="分值分配方式"
                    value={bpAllocation}
                    onChange={setBpAllocation}
                    options={[
                      { value: "even", label: "按题量均分" },
                      { value: "by_difficulty", label: "按难度加权" },
                    ]}
                  />
                </Field>
              </div>
              <div style={{ marginTop: "var(--sp-3)" }}>
                <span className="field-label">题型配额</span>
                <div className="grid-3" style={{ marginTop: "var(--sp-2)" }}>
                  {QUESTION_TYPE_OPTIONS.map((t) => (
                    <Field key={t.value} label={t.label} htmlFor={`bp-type-${t.value}`}>
                      <TextInput
                        id={`bp-type-${t.value}`}
                        type="number"
                        min={0}
                        max={50}
                        value={bpTypeQuota[t.value] ?? 0}
                        aria-label={`${t.label} 配额`}
                        onChange={(e) =>
                          setBpTypeQuota((prev) => ({
                            ...prev,
                            [t.value]: Number(e.target.value) || 0,
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: "var(--sp-3)" }}>
                <span className="field-label">难度配额</span>
                <div className="grid-3" style={{ marginTop: "var(--sp-2)" }}>
                  {catalogTags
                    .filter((t) => t.group === "difficulty")
                    .map((tag) => (
                      <Field key={tag.id} label={tag.name} htmlFor={`bp-diff-${tag.id}`}>
                        <TextInput
                          id={`bp-diff-${tag.id}`}
                          type="number"
                          min={0}
                          max={50}
                          value={bpDifficultyQuota[tag.id] ?? 0}
                          aria-label={`${tag.name} 配额`}
                          onChange={(e) =>
                            setBpDifficultyQuota((prev) => ({
                              ...prev,
                              [tag.id]: Number(e.target.value) || 0,
                            }))
                          }
                        />
                      </Field>
                    ))}
                </div>
              </div>
              <div style={{ marginTop: "var(--sp-3)" }}>
                <span className="field-label">标签选择</span>
                <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                  {TAG_GROUP_ORDER.flatMap((group) =>
                    catalogTags
                      .filter((t) => t.group === group)
                      .map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`chip is-tag${bpTagIds.includes(tag.id) ? " is-on" : ""}`}
                          aria-pressed={bpTagIds.includes(tag.id)}
                          onClick={() =>
                            setBpTagIds((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((x) => x !== tag.id)
                                : [...prev, tag.id],
                            )
                          }
                        >
                          {tag.name}
                        </button>
                      )),
                  )}
                </div>
              </div>
              {bpShortfall.length > 0 ? (
                <Callout tone="danger" title="题池数量不足">
                  <ul style={{ margin: "var(--sp-2) 0 0", paddingLeft: "var(--sp-5)" }}>
                    {bpShortfall.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
            </div>
          </div>
        }
        confirmText="生成"
        onCancel={() => {
          setBlueprintOpen(false);
          setBpShortfall([]);
        }}
        onConfirm={() => void runBlueprint()}
      />

      {/* 重新生成的二次确认与差异清单（FR-AUT-03）。 */}
      <Dialog
        open={bpDiff !== null}
        onClose={() => setBpDiff(null)}
        title="重新生成会覆盖当前卷面"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBpDiff(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!bpDiff) return;
                void applyBlueprint(bpDiff.next);
              }}
            >
              确认替换
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="section-note">
            抽题结果与当前卷面有差异，替换后手工微调会丢失。请确认下列差异后再替换。
          </p>
          {bpDiff && bpDiff.added.length > 0 ? (
            <div>
              <div className="field-label">新增（{bpDiff.added.length}）</div>
              <ul className="rule-list">
                {bpDiff.added.map((qid) => (
                  <li key={qid}>
                    <span className="rule-dot">+</span>
                    <span>
                      {pickedDetails[qid]?.code ?? qid} · {pickedDetails[qid]?.stem ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {bpDiff && bpDiff.removed.length > 0 ? (
            <div>
              <div className="field-label">移除（{bpDiff.removed.length}）</div>
              <ul className="rule-list">
                {bpDiff.removed.map((qid) => (
                  <li key={qid}>
                    <span className="rule-dot">−</span>
                    <span>
                      {pickedDetails[qid]?.code ?? qid} · {pickedDetails[qid]?.stem ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {bpDiff && bpDiff.changed.length > 0 ? (
            <div>
              <div className="field-label">分值变化（{bpDiff.changed.length}）</div>
              <ul className="rule-list">
                {bpDiff.changed.map((item) => (
                  <li key={item.qid}>
                    <span className="rule-dot">≈</span>
                    <span>
                      {pickedDetails[item.qid]?.code ?? item.qid} ·{" "}
                      {pickedDetails[item.qid]?.stem ?? ""} · {item.from} → {item.to} 分
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Dialog>

      {/* 提醒项的覆盖理由（FR-AUT-06）。 */}
      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="填写提醒项的覆盖理由"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverrideOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void doPublish(overrideReasons)}>
              确认发布
            </Button>
          </>
        }
      >
        <div className="stack">
          {check.checks
            .filter((c) => !c.ok && c.level === "warning")
            .map((c) => (
              <Field key={c.key} label={c.label} hint={c.detail} htmlFor={`override-${c.key}`}>
                <TextArea
                  id={`override-${c.key}`}
                  value={overrideReasons[c.key] ?? ""}
                  placeholder="填写覆盖理由，例如：本次侧重主观题作答能力"
                  onChange={(event) =>
                    setOverrideReasons((prev) => ({ ...prev, [c.key]: event.target.value }))
                  }
                />
              </Field>
            ))}
        </div>
      </Dialog>

      {/* 实体标签弹窗（原型 admin.entity.tags）。 */}
      <EntityTagsDialog
        target={tagTarget}
        onClose={() => setTagTarget(null)}
        {...(remote
          ? {
              onSave: async (tags: string[]) => {
                await saveMeta({ tags });
              },
              catalogTags,
            }
          : {})}
      />
    </>
  );
}
