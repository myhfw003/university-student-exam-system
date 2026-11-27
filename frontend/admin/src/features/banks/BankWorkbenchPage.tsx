/* ==========================================================================
   知行测评 · 管理端题库工作台
   --------------------------------------------------------------------------
   对应原型 admin.bank。三个标签页：
     题目      —— 管理题目状态（发布 / 停用 / 恢复）
     候选题    —— 审核导入与 AI 生成的草稿题目
     内容生产  —— CSV 导入与 AI 生成（均产出草稿候选题）
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Field,
  Meter,
  PageHead,
  SearchInput,
  Segmented,
  SelectInput,
  Stat,
  Tabs,
  TagFilter,
  TextArea,
  TextInput,
  downloadText,
  hasPermission,
  toast,
  useAuth,
} from "@exam/shared";
import {
  AI_MAX_TAGS,
  AI_PROMPT_MAX_LENGTH,
  adoptImportBatch,
  generateAiQuestionsStream,
  isBackendEnabled,
  loadAiProviders,
  loadImportTemplate,
  updateImportMapping,
  uploadImportBatch,
  type AiGenerationResult,
  type AiGenerationStreamItem,
  type AiProvider,
  type ImportBatchDetail,
  type ImportRow,
  type ImportTemplate,
} from "@exam/shared/api";
import {
  MOCK_AI_PROVIDERS,
  commitGeneration,
  commitImport,
  createGeneration,
  createImportBatch,
  updateImportBatch,
  useCatalog,
} from "@exam/shared/mock/catalog";
import {
  IMPORT_TEMPLATE_COLUMNS,
  IMPORT_TEMPLATE_FILE_NAME,
  IMPORT_TEMPLATE_NOTES,
  importTemplateCsv,
} from "@exam/shared/mock/importTemplate";
import type { Question, TagMatchMode } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { DifficultyChip, SourceBadge, StatusBadge, TagChips, TypeBadge } from "../shared/bits";
import { QuestionEditor } from "../shared/QuestionEditor";
import { TagPicker } from "../shared/TagPicker";
import { useCatalogTags } from "../shared/useCatalogTags";
import {
  IMPORT_FIELDS,
  buildImportRows,
  guessMapping,
  parseImportFile,
  type ColumnMapping,
  type ParsedTable,
} from "./importFile";
import { useAdminBanks, useAdminQuestions, type AdminBankRow } from "./useAdminBanks";
import { fetchImportBatchDetail, useImportBatches } from "./useImportBatches";

/** 工作台标签页。 */
type WorkbenchTab = "questions" | "candidates" | "produce";

/** 预览行（mock 与 HTTP 同一形状）。 */
interface ImportRowView {
  no: number;
  stem: string;
  type: Question["type"];
  score: number;
  options: Array<{ key: string; text: string }>;
  answer: string[];
  analysis: string;
  tags: string[];
  valid: boolean;
  /** 出错原因（服务端给的错误明细）。 */
  error?: string;
}

/**
 * 服务端解析出的行 → 预览行。
 *
 * 服务端把解析结果放在 `parsed`（JSON 文本）里：字段与题目一致，
 * 这里拆成预览要用的形状。
 */
function toPreviewRow(row: ImportRow): ImportRowView {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(row.parsed || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const options = Array.isArray(parsed.options)
    ? (parsed.options as Array<Record<string, unknown>>)
    : [];
  return {
    no: row.rowNumber,
    stem: String(parsed.stem ?? ""),
    type: String(parsed.type ?? "single") as Question["type"],
    score: Number(parsed.score ?? 5),
    options: options.map((o) => ({ key: String(o.key ?? ""), text: String(o.text ?? "") })),
    answer: options
      .filter((o) => o.isCorrect === true)
      .map((o) => String(o.key ?? "")),
    analysis: String(parsed.analysis ?? ""),
    tags: Array.isArray(parsed.tagIds) ? parsed.tagIds.map((t) => String(t)) : [],
    valid: row.valid,
    error: row.errors.join("；"),
  };
}

/**
 * 题库统计。
 *
 * 跨库视图（`__all__`）把各题库的统计加起来——真实后端的统计在题库详情里，
 * 逐库取回后汇总；不在任何题库里的题目不计入（跨库合计是各题库之和）。
 */
function statsOf(bankId: string, banks: AdminBankRow[]) {
  if (bankId && bankId !== "__all__") {
    const bank = banks.find((b) => b.id === bankId);
    return (
      bank?.stats ?? {
        total: 0,
        published: 0,
        draft: 0,
        disabled: 0,
        objective: 0,
        subjective: 0,
      }
    );
  }
  return banks.reduce(
    (acc, bank) => ({
      total: acc.total + bank.stats.total,
      published: acc.published + bank.stats.published,
      draft: acc.draft + bank.stats.draft,
      disabled: acc.disabled + bank.stats.disabled,
      objective: acc.objective + bank.stats.objective,
      subjective: acc.subjective + bank.stats.subjective,
    }),
    { total: 0, published: 0, draft: 0, disabled: 0, objective: 0, subjective: 0 },
  );
}

/** 题库工作台。 */
export function BankWorkbenchPage() {
  const { bankId = "__all__" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as WorkbenchTab) || "questions";
  const remote = isBackendEnabled();
  // AI 生成是独立权限点：没有就不给入口（而不是给进去再报 403）。
  const roles = useAuth((state) => state.user?.roles);
  const canGenerateAi = hasPermission(roles, "ai:generate");
  // 标签目录：HTTP 模式来自服务端（标签 ID 是数字主键）。
  const { tags } = useCatalogTags();
  const imports = useCatalog((state) => state.imports);
  const generations = useCatalog((state) => state.generations);

  const { banks } = useAdminBanks();
  // 导入批次：上传当次就能看到逐行结果，重新打开已有批次要另外取。
  const { batches: importBatches, refresh: refreshImportBatches } = useImportBatches();
  const bank = banks.find((b) => b.id === bankId) ?? null;
  const title = !bankId || bankId === "__all__" ? "全部题库" : (bank?.name ?? "全部题库");
  const stats = statsOf(bankId, banks);

  // 题目筛选。
  // 取值用数据层的口径（all 表示不限），标签只是显示文案：
  // 混用中文标签会把请求打歪——服务端只认 all / published 这类取值。
  const [statusFilter, setStatusFilter] = useState<"published" | "draft" | "disabled" | "all">(
    "published",
  );
  const [typeFilter, setTypeFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  // 标签筛选（原型：领域 + 能力两组 chip，多选为「任一命中」）。
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // 「包含子标签」默认开启；命中模式默认「任一命中」（FR-CAT-02）。
  const [tagIncludeDescendants, setTagIncludeDescendants] = useState(true);
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>("any");

  // 候选题筛选与选择。
  const [sourceFilter, setSourceFilter] = useState("全部");
  const [picked, setPicked] = useState<string[]>([]);

  // 题目列表：过滤在服务端（题目可能成千上万）。
  const questionQuery = useAdminQuestions({
    bankId,
    status: statusFilter,
    type: typeFilter,
    keyword,
    tagIds: tagFilter,
    includeDescendants: tagIncludeDescendants,
    matchMode: tagMatchMode,
    enabled: tab === "questions",
  });
  const candidateQuery = useAdminQuestions({
    bankId,
    status: "draft",
    type: "all",
    keyword: "",
    tagIds: [],
    enabled: tab === "candidates",
  });

  // 批量操作结果（逐条列出成功与失败原因，FR-CAT-04）。
  const [batchResult, setBatchResult] = useState<{
    action: string;
    changed: number;
    failures: Array<{ id: string; reason: string }>;
  } | null>(null);

  // 题目编辑器。
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
  /** 批量丢弃二次确认：待丢弃的候选题数量。 */
  const [pendingBatchDiscard, setPendingBatchDiscard] = useState<number | null>(null);

  // 内容生产。
  const [produceMode, setProduceMode] = useState<"import" | "gen">("import");
  // 真实导入：文件 → 表格 → 列映射 → 解析结果。
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  /** HTTP 模式：导入批次在服务端（解析也在服务端做）。 */
  const [serverImport, setServerImport] = useState<ImportBatchDetail | null>(null);
  const [targetBank, setTargetBank] = useState(bankId === "__all__" ? (banks[0]?.id ?? "") : bankId);
  const [genType, setGenType] = useState("single");
  const [genCount, setGenCount] = useState(3);
  const [genPrompt, setGenPrompt] = useState("");
  const [genTags, setGenTags] = useState<string[]>([]);
  const [batchId, setBatchId] = useState("");
  /** 难度标签（两种模式都有：mock 用本地目录，HTTP 用服务端目录）。 */
  const [genDifficultyTagId, setGenDifficultyTagId] = useState("");
  /** 可切换的 AI 供应商与模型。 */
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [genProvider, setGenProvider] = useState("");
  const [genModel, setGenModel] = useState("");
  /** 最近一次生成的逐题结果（HTTP 模式）。 */
  const [genResult, setGenResult] = useState<AiGenerationResult | null>(null);
  /** 流式生成：一道道回来的题（边生成边显示）。 */
  const [genItems, setGenItems] = useState<AiGenerationStreamItem[]>([]);
  /** 流式生成的进度：目标几道、已经回来几道。 */
  const [genProgress, setGenProgress] = useState<{ requested: number; done: number } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  /** 导入模板：HTTP 模式取服务端那份，mock 模式用本地同样的定义。 */
  const [template, setTemplate] = useState<ImportTemplate | null>(null);

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  /* ----------------------------------------------------------- 题目列表 */

  // 题目列表：mock 模式在前端筛，HTTP 模式交给服务端筛。
  const questionList = questionQuery.questions;

  /* ----------------------------------------------------------- 候选题列表 */

  const candidateAll = candidateQuery.questions;

  const candidateList = useMemo(
    () =>
      candidateAll.filter((q) => {
        if (sourceFilter !== "全部" && (q.source ?? "manual") !== sourceFilter) return false;
        return true;
      }),
    [candidateAll, sourceFilter],
  );

  /* ----------------------------------------------------------- 内容生产 */

  /** 难度标签：客观题都要挂一个难度维度的标签。 */
  const difficultyTags = useMemo(
    () => tags.filter((tag) => tag.group === "difficulty"),
    [tags],
  );

  /** 难度默认选中「中等」（没有就选第一个）。 */
  useEffect(() => {
    if (genDifficultyTagId) return;
    const preferred = difficultyTags.find((tag) => tag.level === 2) ?? difficultyTags[0];
    if (preferred) setGenDifficultyTagId(preferred.id);
  }, [difficultyTags, genDifficultyTagId]);

  /** 当前选中的供应商。 */
  const currentProvider = useMemo(
    () => providers.find((provider) => provider.name === genProvider) ?? null,
    [providers, genProvider],
  );

  /**
   * 导入模板。
   *
   * HTTP 模式取服务端那份（模板与解析规则同源）；mock 模式没有服务端，
   * 用本地同样的定义——两份由 `scripts/check-question-import-columns.py` 盯着。
   */
  useEffect(() => {
    if (!remote) {
      setTemplate({
        fileName: IMPORT_TEMPLATE_FILE_NAME,
        csv: importTemplateCsv(),
        columns: IMPORT_TEMPLATE_COLUMNS.map((column) => ({ ...column })),
        notes: [...IMPORT_TEMPLATE_NOTES],
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadImportTemplate();
        if (!cancelled) setTemplate(loaded);
      } catch {
        // 模板拿不到不影响上传：只是没有「下载模板」与列说明。
        if (!cancelled) setTemplate(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote]);

  /** 可用的 AI 供应商与模型（模型在供应商配置里列着，可随时切）。 */
  useEffect(() => {
    if (!remote) {
      setProviders(MOCK_AI_PROVIDERS);
      setGenProvider((current) => current || MOCK_AI_PROVIDERS[0]?.name || "");
      setGenModel((current) => current || MOCK_AI_PROVIDERS[0]?.defaultModel || "");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadAiProviders();
        if (cancelled) return;
        setProviders(loaded);
        const first = loaded[0];
        setGenProvider((current) => current || first?.name || "");
        setGenModel((current) => current || first?.defaultModel || "");
      } catch {
        if (!cancelled) setProviders([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote]);

  /** 换供应商：模型跟着回到该供应商的默认模型。 */
  const handleProviderChange = (name: string): void => {
    setGenProvider(name);
    const provider = providers.find((item) => item.name === name);
    setGenModel(provider?.defaultModel || provider?.models[0] || "");
  };

  /** 下载导入模板。 */
  const handleDownloadTemplate = (): void => {
    if (!template) {
      toast.error("模板还没加载好，请稍后再试");
      return;
    }
    downloadText(template.fileName, template.csv, "text/csv;charset=utf-8");
  };

  const activeBatch = useMemo(() => {
    if (!batchId) return null;
    if (produceMode === "import") return imports.find((b) => b.id === batchId) ?? null;
    return generations.find((b) => b.id === batchId) ?? null;
  }, [batchId, produceMode, imports, generations]);

  /** 预览行：mock 来自本地批次，HTTP 来自服务端的解析结果。 */
  const previewRows = useMemo(() => {
    if (remote) return (serverImport?.rows ?? []).map(toPreviewRow);
    return activeBatch?.rows ?? [];
  }, [remote, serverImport, activeBatch]);

  /**
   * 列映射被锁住。
   *
   * 重新打开的批次拿不到**文件表头**（后端只在解析当场返回，没存），
   * 列下拉里没有可选的列名——这时改列映射是改不动的，索性锁上并说明原因，
   * 别让人对着一个只有「（不映射）」的下拉发呆。
   */
  const mappingLocked = Boolean(serverImport) && (serverImport?.headers.length ?? 0) === 0;

  /** 选文件 → 真实解析（.csv / .xlsx）。 */
  const handleFilePick = async (file: File | null): Promise<void> => {
    if (!file) return;
    setParseError(null);

    if (remote) {
      // HTTP 模式：文件交给**服务端**解析——两边各算一套，
      // 管理员看到的预览与最终入库的题目会对不上。
      try {
        const detail = await uploadImportBatch(file);
        setServerImport(detail);
        setBatchId(detail.batch.id);
        setFileName(file.name);
        setMapping(detail.batch.columnMapping);
        setParsed(null);
        toast.ok(`已解析 ${detail.batch.totalRows} 行，请确认列映射`);
      } catch (error) {
        setServerImport(null);
        setParseError(error instanceof Error ? error.message : "文件解析失败");
      }
      return;
    }

    try {
      const table = await parseImportFile(file);
      setParsed(table);
      setFileName(file.name);
      setMapping(guessMapping(table.headers));
      toast.ok(`已解析 ${table.rows.length} 行，请确认列映射`);
    } catch (error) {
      setParsed(null);
      setParseError(error instanceof Error ? error.message : "文件解析失败");
    }
  };

  /** 本地解析结果（随列映射实时重算；只用于 mock 模式）。 */
  const localRows = useMemo(
    () =>
      parsed
        ? buildImportRows(
            parsed.rows,
            parsed.headers,
            mapping,
            tags.map((t) => t.name),
          )
        : [],
    [parsed, mapping, tags],
  );

  /** 改列映射：重新解析并同步到批次（若已解析）。 */
  const handleMappingChange = (field: string, column: string): void => {
    const next = { ...mapping };
    if (!column) delete next[field];
    else next[field] = column;
    setMapping(next);
    if (remote) {
      if (!batchId) return;
      void updateImportMapping(batchId, next)
        .then((detail) => setServerImport(detail))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "列映射更新失败");
        });
      return;
    }
    if (!parsed) return;
    const rows = buildImportRows(parsed.rows, parsed.headers, next, tags.map((t) => t.name));
    if (batchId && produceMode === "import") {
      const result = updateImportBatch(batchId, {
        mapping: next,
        rows: rows.map((row) => ({
          no: row.no,
          stem: row.stem,
          type: row.type,
          score: row.score,
          options: row.options,
          answer: row.answer,
          analysis: row.analysis,
          tags: row.tags,
          valid: row.valid,
        })),
      });
      if (!result.ok) toast.error(result.message ?? "列映射更新失败");
    }
  };

  const handleParse = () => {
    if (!parsed) {
      toast.error("请先选择试题文件");
      return;
    }
    const result = createImportBatch({
      fileName: fileName || "未命名文件",
      operator: "陈砚之",
      columns: parsed.headers,
      mapping,
      rows: localRows.map((row) => ({
        no: row.no,
        stem: row.stem,
        type: row.type,
        score: row.score,
        options: row.options,
        answer: row.answer,
        analysis: row.analysis,
        tags: row.tags,
        valid: row.valid,
      })),
    });
    if (!result.ok || !result.batch) {
      toast.error(result.message ?? "解析失败");
      return;
    }
    setBatchId(result.batch.id);
    const bad = localRows.filter((row) => !row.valid).length;
    toast.ok(
      bad > 0
        ? `解析完成，共 ${result.batch.rowCount} 行待确认，其中 ${bad} 行有问题，请修正列映射`
        : `解析完成，共 ${result.batch.rowCount} 行待确认`,
    );
  };

  /**
   * 生成候选题。
   *
   * HTTP 模式走服务端：模型产的题按**与文件导入相同的规则**校验，
   * 通过的题直接落成草稿候选题，不通过的逐条说明原因。
   * mock 模式没有模型，返回固定样例。
   */
  const handleGenerate = async () => {
    if (remote) {
      if (!genProvider) {
        toast.error("请选择 AI 供应商");
        return;
      }
      if (!genDifficultyTagId) {
        toast.error("请选择难度");
        return;
      }
      if (!genPrompt.trim()) {
        toast.error("请填写出题要求");
        return;
      }
      // 这三条与服务端的校验一一对应：界面上先拦住，
      // 免得发出去只换来一句「请求参数校验失败」，还不知道是哪儿错了。
      if (genPrompt.length > AI_PROMPT_MAX_LENGTH) {
        toast.error(`出题要求最长 ${AI_PROMPT_MAX_LENGTH} 字，现在 ${genPrompt.length} 字`);
        return;
      }
      if (genTags.length > AI_MAX_TAGS) {
        toast.error(`知识点标签最多 ${AI_MAX_TAGS} 个`);
        return;
      }
      if (genCount < 1 || genCount > 10) {
        toast.error("生成数量要在 1 到 10 之间");
        return;
      }

      setGenBusy(true);
      setGenItems([]);
      setGenProgress({ requested: genCount, done: 0 });

      const push = (item: AiGenerationStreamItem): void => {
        setGenItems((prev) => [...prev, item]);
        setGenProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      };

      try {
        // 流式：服务器每落一道题就推一条，题目一道道出现，
        // 不用等整批出完（8 道题实测 25–60 秒）。
        await generateAiQuestionsStream(
          {
            provider: genProvider,
            model: genModel,
            count: genCount,
            type: genType,
            difficultyTagId: genDifficultyTagId,
            tagIds: genTags,
            prompt: genPrompt,
          },
          {
            onQuestion: push,
            onFailed: push,
            onError: (error) => {
              // 流开始后 HTTP 状态码已经发出去了，错误只能靠这条事件：
              // 不提示的话，老师会看着像「生成完了却一道题都没有」。
              toast.error(error.message);
            },
            onDone: (summary) => {
              setGenResult({
                provider: summary.provider,
                providerName: summary.providerName,
                model: summary.model,
                requested: summary.requested,
                succeeded: summary.succeeded,
                failed: summary.failed,
                items: [],
              });
              if (summary.failed > 0) {
                toast.error(`已生成 ${summary.succeeded} 道候选题，${summary.failed} 道未通过校验`);
              } else {
                toast.ok(`已生成 ${summary.succeeded} 道候选题，请到候选题队列审核`);
              }
              candidateQuery.refresh();
            },
          },
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "生成失败");
      } finally {
        setGenBusy(false);
        setGenProgress(null);
      }
      return;
    }

    const result = createGeneration({
      count: genCount,
      type: genType as "single",
      difficulty: difficultyTags.find((tag) => tag.id === genDifficultyTagId)?.name ?? "中等",
      prompt: genPrompt,
      tagIds: genTags,
      operator: "陈砚之",
    });
    if (!result.ok || !result.batch) {
      toast.error(result.message ?? "生成失败");
      return;
    }
    setBatchId(result.batch.id);
    toast.ok(`已生成 ${result.batch.count} 道候选题`);
  };

  const handleAdopt = async () => {
    if (remote && produceMode === "import") {
      if (!batchId) {
        toast.error("请先解析文件");
        return;
      }
      try {
        const result = await adoptImportBatch(batchId);
        if (result.alreadyAdopted) {
          toast.ok("该批次已采纳过");
        } else if (result.failures.length > 0) {
          toast.error(`已采纳 ${result.adopted} 道，${result.failures.length} 行被跳过`);
        } else {
          toast.ok(`已采纳 ${result.adopted} 道候选题，请到候选题队列审核`);
        }
        setBatchId("");
        setServerImport(null);
        candidateQuery.refresh();
        // 批次状态变了（已采纳），列表要跟着更新。
        refreshImportBatches();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "采纳失败");
      }
      return;
    }

    const result =
      produceMode === "import"
        ? commitImport(batchId, targetBank)
        : commitGeneration(batchId, targetBank);
    if (!result.ok) {
      toast.error(result.message ?? "采纳失败");
      return;
    }
    toast.ok(`已采纳 ${result.count} 道候选题，请到候选题队列审核`);
    setBatchId("");
  };

  /**
   * 打开一个已有的导入批次。
   *
   * 上传当次就有逐行结果，但那些结果存在**服务端**：
   * 过一阵再回来看这个批次，得重新取（`GET /imports/{id}`）。
   *
   * 注意：批次详情**不给文件表头**（表头只在解析当场拿得到，后端没存），
   * 所以重新打开的批次改不了列映射——要改得重新上传原文件。
   */
  const handleOpenBatch = async (id: string) => {
    if (!remote) {
      // mock 模式：整份批次就在本地内容仓库里。
      setBatchId(id);
      setParsed(null);
      setFileName("");
      return;
    }
    try {
      const detail = await fetchImportBatchDetail(id);
      if (!detail) return;
      setServerImport(detail);
      setBatchId(detail.batch.id);
      setMapping(detail.batch.columnMapping);
      setParsed(null);
      toast.ok(`已打开批次「${detail.batch.fileName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批次详情加载失败");
    }
  };

  /**
   * 打开题目编辑器。
   *
   * 先取回详情：列表里只有摘要（没有选项、答案、要点、附件），
   * 直接拿摘要编辑会把题目的内容清空。
   */
  const openEditor = async (question: Question) => {
    const detail = await questionQuery.loadDetail(question.id);
    if (!detail) {
      toast.error("题目详情加载失败");
      return;
    }
    setEditingQuestion(detail);
    setEditorOpen(true);
  };

  const handleStatus = async (question: Question, status: Question["status"]) => {
    try {
      await questionQuery.setStatus(question.id, status);
      toast.ok(
        status === "published"
          ? `题目 ${question.code ?? question.id} 已发布`
          : status === "disabled"
            ? `题目 ${question.code ?? question.id} 已停用`
            : `题目 ${question.code ?? question.id} 已转为草稿`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "状态更新失败");
    }
  };

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const batchPublish = async () => {
    if (picked.length === 0) {
      toast.error("请先选择候选题");
      return;
    }
    const result = await candidateQuery.batchStatus(picked, "published");
    setBatchResult({
      action: "发布",
      changed: result.changed,
      failures: result.failures,
    });
    if (result.failures.length === 0) {
      toast.ok(`已发布 ${result.changed} 道候选题`);
    } else {
      toast.error(`已发布 ${result.changed} 道，${result.failures.length} 道失败`);
    }
    setPicked([]);
  };

  /** 批量丢弃：先空选保护，再走二次确认。 */
  const batchDiscard = () => {
    if (picked.length === 0) {
      toast.error("请先选择候选题");
      return;
    }
    setPendingBatchDiscard(picked.length);
  };

  const confirmBatchDiscard = async () => {
    const result = await candidateQuery.discardMany(picked);
    setPendingBatchDiscard(null);
    setBatchResult({
      action: "丢弃",
      changed: result.changed,
      failures: result.failures,
    });
    if (result.failures.length === 0) {
      toast.ok(`已丢弃 ${result.changed} 道候选题`);
    } else {
      toast.error(`已丢弃 ${result.changed} 道，${result.failures.length} 道失败`);
    }
    setPicked([]);
  };

  const tabs: Array<{ value: WorkbenchTab; label: string; badge?: number }> = [
    { value: "questions", label: "题目", badge: stats.total },
    { value: "candidates", label: "候选题", badge: stats.draft },
    { value: "produce", label: "内容生产" },
  ];

  return (
    <>
      <PageHead
        title={title}
        sub={bank ? (bank.desc || "题库工作台") : "跨库视图：所有题库的内容汇总在同一工作台中处理。"}
        actions={
          <>
            <Button onClick={() => navigate("/banks")}>
              <Icon name="library" />
              题库清单
            </Button>
            {bank ? (
              <Button onClick={() => navigate(`/banks?edit=${bank.id}`)}>编辑题库</Button>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                setEditingQuestion(null);
                setEditorOpen(true);
              }}
            >
              <Icon name="plus" />
              新建题目
            </Button>
          </>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat label="已发布" value={stats.published} unit="道" hint="可被组卷引用" />
        <Stat label="草稿候选题" value={stats.draft} unit="道" hint="待审核发布" />
        <Stat label="已停用" value={stats.disabled} unit="道" hint="可恢复为已发布" />
        <Stat label="客观题分值" value={stats.objective} unit="分" hint="单选 / 多选 / 判断" />
        <Stat label="主观题分值" value={stats.subjective} unit="分" hint="简答 / 综合操作" />
      </div>

      <Tabs
        items={tabs}
        value={tab}
        onChange={(next) => setTab(next)}
        label="题库工作台标签页"
        variant="seg"
      />

      {/* ------------------------------------------------------- 题目 */}
      {tab === "questions" ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">题目</h2>
            <span className="text-sm text-3">{questionList.length} 道</span>
          </div>
          <div className="card-body">
            <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
              <Segmented
                label="状态筛选"
                value={statusFilter}
                onChange={(next) => setStatusFilter(next)}
                options={[
                  { value: "published", label: "已发布" },
                  { value: "draft", label: "草稿" },
                  { value: "disabled", label: "已停用" },
                  { value: "all", label: "全部" },
                ]}
              />
              <SelectInput
                aria-label="题型筛选"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="all">全部题型</option>
                <option value="single">单选题</option>
                <option value="multi">多选题</option>
                <option value="judge">判断题</option>
                <option value="short">简答题</option>
                <option value="comprehensive">综合操作题</option>
              </SelectInput>
              <SearchInput
                label="搜索题号或题干"
                value={keyword}
                placeholder="搜索题号或题干"
                onSearch={setKeyword}
                onChange={setKeyword}
              />
            </div>
            <TagFilter
              groups={[
                {
                  group: "domain",
                  label: "领域",
                  tags: tags.filter((t) => t.group === "domain"),
                },
                {
                  group: "ability",
                  label: "能力",
                  tags: tags.filter((t) => t.group === "ability"),
                },
              ]}
              selected={tagFilter}
              onToggle={(tagId) =>
                setTagFilter((prev) =>
                  prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
                )
              }
              groupLabel="标签筛选"
              includeDescendants={tagIncludeDescendants}
              onIncludeDescendantsChange={setTagIncludeDescendants}
              matchMode={tagMatchMode}
              onMatchModeChange={setTagMatchMode}
            />
          </div>
          <div className="card-body is-flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">编号</th>
                    <th scope="col">题目</th>
                    <th scope="col">来源</th>
                    <th scope="col">状态</th>
                    <th scope="col">分值</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {questionList.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty">
                          <span className="empty-title">没有符合条件的题目</span>
                          <span className="empty-body">
                            调整筛选条件，或通过内容生产补充题目。
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    questionList.map((q) => (
                      <tr key={q.id}>
                        <td className="text-xs mono">{q.code ?? q.id}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{q.stem}</div>
                          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                            <TypeBadge type={q.type} />
                            <DifficultyChip tags={q.tags} catalog={tags} />
                            <TagChips tags={q.tags} limit={3} catalog={tags} />
                          </div>
                        </td>
                        <td>
                          <SourceBadge source={q.source} />
                        </td>
                        <td>
                          <StatusBadge status={q.status} />
                        </td>
                        <td className="num">{q.score}</td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            onClick={() => void openEditor(q)}
                          >
                            编辑
                          </Button>{" "}
                          {q.status === "published" ? (
                            <Button size="sm" onClick={() => void handleStatus(q, "disabled")}>
                              停用
                            </Button>
                          ) : q.status === "disabled" ? (
                            <Button size="sm" onClick={() => void handleStatus(q, "published")}>
                              恢复
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void handleStatus(q, "published")}
                            >
                              发布
                            </Button>
                          )}{" "}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setPendingDelete(q)}
                          >
                            删除
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------- 候选题 */}
      {tab === "candidates" ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">候选题队列</h2>
            <span className="text-sm text-3">共 {candidateAll.length} 道待审核</span>
          </div>
          <div className="card-body">
            <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
              <Segmented
                label="来源筛选"
                value={sourceFilter}
                onChange={(next) => setSourceFilter(next)}
                options={[
                  { value: "全部", label: "全部来源" },
                  { value: "import", label: "导入" },
                  { value: "ai", label: "AI 生成" },
                  { value: "manual", label: "手工录入" },
                ]}
              />
              <div className="row-tight" style={{ marginLeft: "auto" }}>
                <Button size="sm" onClick={() => setPicked(candidateList.map((q) => q.id))}>
                  <Icon name="check" />
                  全选本页
                </Button>
                <Button size="sm" onClick={() => setPicked([])}>
                  清空选择
                </Button>
                <Button size="sm" variant="primary" onClick={() => void batchPublish()}>
                  <Icon name="check" />
                  批量发布
                </Button>
                <Button size="sm" variant="danger" onClick={() => void batchDiscard()}>
                  批量丢弃
                </Button>
              </div>
            </div>
            <Callout icon={<Icon name="info" />} title="候选题需审核后发布">
              导入与 AI 生成的内容先进入草稿状态，审核确认无误后发布；仅「已发布」题目可被组卷与练习引用。
            </Callout>
            {batchResult ? (
              <Callout
                tone={batchResult.failures.length > 0 ? "warn" : "ok"}
                title={`批量${batchResult.action}：成功 ${batchResult.changed} 道，失败 ${batchResult.failures.length} 道`}
              >
                {batchResult.failures.length > 0 ? (
                  <ul className="rule-list" style={{ marginTop: "var(--sp-3)" }}>
                    {batchResult.failures.map((failure) => (
                      <li key={failure.id}>
                        {failure.id} · {failure.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "全部成功。"
                )}
              </Callout>
            ) : null}
          </div>
          <div className="card-body is-flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">编号</th>
                    <th scope="col">题目</th>
                    <th scope="col">来源</th>
                    <th scope="col">批次</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidateList.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty">
                          <span className="empty-title">暂无候选题</span>
                          <span className="empty-body">
                            通过「内容生产」导入试题或使用 AI 生成，即可在此审核。
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    candidateList.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={picked.includes(q.id)}
                            aria-label={`选择 ${q.code ?? q.id}`}
                            onChange={() => togglePick(q.id)}
                          />
                        </td>
                        <td className="text-xs mono">{q.code ?? q.id}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{q.stem}</div>
                          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                            <TypeBadge type={q.type} />
                            <DifficultyChip tags={q.tags} catalog={tags} />
                            <TagChips tags={q.tags} limit={3} catalog={tags} />
                          </div>
                        </td>
                        <td>
                          <SourceBadge source={q.source} />
                        </td>
                        <td className="text-xs text-3">{q.batchId ?? "—"}</td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            onClick={() => void openEditor(q)}
                          >
                            编辑
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void handleStatus(q, "published")}
                          >
                            发布
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setPendingDelete(q)}
                          >
                            丢弃
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- 内容生产 */}
      {tab === "produce" ? (
        <>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">内容生产</h2>
              <span className="text-sm text-3">导入与 AI 生成均产出草稿候选题</span>
            </div>
            <div className="card-body">
              <Segmented
                label="生产方式"
                value={produceMode}
                onChange={(next) => {
                  setProduceMode(next);
                  setBatchId("");
                }}
                options={[
                  { value: "import", label: "导入试题" },
                  { value: "gen", label: "AI 生成", disabled: !canGenerateAi },
                ]}
              />

              <div style={{ marginTop: "var(--sp-4)" }}>
                {produceMode === "import" ? (
                  <div className="stack">
                    <Field
                      htmlFor="imp-file"
                      label="试题文件"
                      hint="支持 .csv（UTF-8 / GBK）与 .xlsx（读取首个工作表）。选择文件后自动解析。"
                    >
                      <input
                        id="imp-file"
                        className="input"
                        type="file"
                        accept=".csv,.xlsx"
                        onChange={(event) => void handleFilePick(event.target.files?.[0] ?? null)}
                      />
                    </Field>
                    {/* 模板：先下载照着填，列怎么写也说清楚。 */}
                    <div>
                      <div className="row">
                        <Button size="sm" onClick={handleDownloadTemplate} disabled={!template}>
                          <Icon name="document" />
                          下载导入模板
                        </Button>
                        <span className="text-sm text-3">
                          不知道文件该长什么样？先下载模板，按列填好再上传。
                        </span>
                      </div>
                      {template ? (
                        <div className="table-wrap" style={{ marginTop: "var(--sp-3)" }}>
                          <table className="table">
                            <thead>
                              <tr>
                                <th scope="col">列</th>
                                <th scope="col">必填</th>
                                <th scope="col">怎么填</th>
                                <th scope="col">示例</th>
                              </tr>
                            </thead>
                            <tbody>
                              {template.columns.map((column) => (
                                <tr key={column.field}>
                                  <td>{column.header}</td>
                                  <td>{column.required ? "是" : "否"}</td>
                                  <td>{column.description}</td>
                                  <td className="text-xs text-3">{column.example}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {template && template.notes.length > 0 ? (
                        <ul className="section-note">
                          {template.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    {parseError ? (
                      <Callout tone="danger" title="文件解析失败">
                        {parseError}
                      </Callout>
                    ) : null}
                    {parsed ? (
                      <Callout tone="info" title="文件已解析">
                        {parsed.headers.length} 列 · {parsed.rows.length} 行
                        {fileName ? ` · ${fileName}` : ""}
                        。请在下方确认列映射，解析结果进入草稿候选题。
                      </Callout>
                    ) : null}
                    {/* 已有批次：上传当次的结果在手里，隔一阵再看要重新取。 */}
                    <div>
                      <span className="field-label">已有导入批次</span>
                      {importBatches.length === 0 ? (
                        <p className="section-note">
                          还没有导入批次。上传一个文件会生成一个批次。
                        </p>
                      ) : (
                        <ul className="list">
                          {importBatches.map((batch) => (
                            <li className="list-row" key={batch.id}>
                              <div>
                                <div style={{ fontWeight: 500 }}>{batch.fileName}</div>
                                <div className="text-xs text-3">
                                  {batch.id} · {batch.createdAt} · {batch.rowCount} 行
                                </div>
                              </div>
                              <div className="row-tight">
                                <Badge tone={batch.status === "adopted" ? "ok" : "warn"}>
                                  {batch.status === "adopted" ? "已采纳" : "待采纳"}
                                </Badge>
                                <Button
                                  size="sm"
                                  onClick={() => void handleOpenBatch(batch.id)}
                                >
                                  打开
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="section-note">
                        打开批次可以看它的逐行结果（哪些行有问题、为什么）。
                        批次详情不给文件表头，所以重新打开的批次改不了列映射——
                        要改得重新上传原文件。
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid-3">
                    <Field label="题型" htmlFor="gen-type">
                      <SelectInput
                        id="gen-type"
                        value={genType}
                        onChange={(event) => setGenType(event.target.value)}
                      >
                        <option value="single">单选题</option>
                        <option value="multi">多选题</option>
                        <option value="judge">判断题</option>
                        <option value="short">简答题</option>
                        <option value="comprehensive">综合操作题</option>
                      </SelectInput>
                    </Field>
                    <Field label="生成数量" htmlFor="gen-count">
                      <TextInput
                        id="gen-count"
                        type="number"
                        min={1}
                        max={8}
                        value={genCount}
                        onChange={(event) => setGenCount(Number(event.target.value) || 1)}
                      />
                    </Field>
                    <Field label="难度" htmlFor="gen-difficulty">
                      <SelectInput
                        id="gen-difficulty"
                        value={genDifficultyTagId}
                        onChange={(event) => setGenDifficultyTagId(event.target.value)}
                      >
                        {difficultyTags.length === 0 ? (
                          <option value="">（没有难度标签）</option>
                        ) : null}
                        {difficultyTags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                  </div>
                )}
              </div>

              {produceMode === "gen" ? (
                <div style={{ marginTop: "var(--sp-4)" }}>
                  <div className="grid-3">
                    <Field label="AI 供应商" htmlFor="gen-provider" hint="服务端配置了哪些模型服务。">
                      <SelectInput
                        id="gen-provider"
                        value={genProvider}
                        onChange={(event) => handleProviderChange(event.target.value)}
                      >
                        {providers.length === 0 ? (
                          <option value="">（没有可用的 AI 服务）</option>
                        ) : null}
                        {providers.map((provider) => (
                          <option key={provider.name} value={provider.name}>
                            {provider.displayName}
                            {provider.configured ? "" : "（未配置 API Key）"}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field
                      label="模型"
                      htmlFor="gen-model"
                      hint="同一供应商的不同模型，质量与速度不一样，可随时切。"
                    >
                      <SelectInput
                        id="gen-model"
                        value={genModel}
                        onChange={(event) => setGenModel(event.target.value)}
                      >
                        {(currentProvider?.models ?? []).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                  </div>
                  {remote && currentProvider && !currentProvider.configured ? (
                    <Callout tone="warn" title="AI 服务未配置">
                      服务端没有配置 {currentProvider.displayName} 的 API Key，生成会失败。
                      请让管理员在服务端配置后再试。
                    </Callout>
                  ) : null}
                  <Field
                    label="知识点标签"
                    hint="标签决定生成题目的归类与难度层级，最多 5 个。"
                  >
                    <TagPicker
                      selected={genTags}
                      onToggle={(tagId) =>
                        setGenTags((prev) => {
                          if (prev.includes(tagId)) {
                            return prev.filter((t) => t !== tagId);
                          }
                          // 超过上限就别加了：加了也是白发一趟（服务端会拒）。
                          if (prev.length >= AI_MAX_TAGS) {
                            toast.error(`知识点标签最多 ${AI_MAX_TAGS} 个`);
                            return prev;
                          }
                          return [...prev, tagId];
                        })
                      }
                      groups={["domain", "knowledge_point"]}
                      label="知识点标签"
                      tags={tags}
                    />
                  </Field>
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <Field
                      label="生成指令"
                      htmlFor="gen-prompt"
                      hint={`最多 ${AI_PROMPT_MAX_LENGTH} 字，当前 ${genPrompt.length} 字`}
                    >
                      <TextArea
                        id="gen-prompt"
                        value={genPrompt}
                        maxLength={AI_PROMPT_MAX_LENGTH}
                        placeholder="例如 围绕 TCP 三次握手与四次挥手生成单选题"
                        onChange={(event) => setGenPrompt(event.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: "var(--sp-4)" }}>
                {remote && produceMode === "import" ? (
                  <div className="field-hint">
                    服务端的导入批次不指定题库：采纳后题目进入候选题队列，
                    再从题库清单里把它挂到题库下。
                  </div>
                ) : null}
                {remote && produceMode === "import" ? null : (
                <Field label={produceMode === "import" ? "导入到题库" : "生成到题库"} htmlFor="imp-bank">
                  <SelectInput
                    id="imp-bank"
                    value={targetBank}
                    onChange={(event) => setTargetBank(event.target.value)}
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                )}
              </div>

              <div className="row" style={{ marginTop: "var(--sp-5)" }}>
                {produceMode === "import" ? (
                  remote ? null : (
                    <Button variant="primary" onClick={handleParse}>
                      <Icon name="document" />
                      解析文件
                    </Button>
                  )
                ) : (
                  <Button
                    variant="primary"
                    disabled={genBusy}
                    onClick={() => void handleGenerate()}
                  >
                    <Icon name="flag" />
                    {genBusy ? "生成中…" : "生成候选题"}
                  </Button>
                )}
                <span className="text-sm text-3">
                  {produceMode === "import"
                    ? "解析为真实文件解析：逐行校验，错误行标红并给出原因，不阻断整批。"
                    : remote
                      ? "生成结果按与文件导入相同的规则校验；通过的题直接进入候选题队列。"
                      : "mock 模式：生成的是示例数据，不调用真实大模型。"}
                </span>
              </div>
            </div>
          </section>

          {/* 生成中也要显示：等第一道题的那几秒（实测 5 秒以上），
              没有进度条就是一片空白，用户不知道系统在干什么。 */}
          {produceMode === "gen" && remote && (genBusy || genItems.length > 0 || genResult) ? (
            <section className="card" style={{ marginTop: "var(--sp-4)" }}>
              <div className="card-head">
                <h2 className="card-title">生成结果</h2>
                <span className="text-sm text-3">
                  {genResult
                    ? `${genResult.providerName} · ${genResult.model} · 成功 ${genResult.succeeded} 道 / 未通过 ${genResult.failed} 道`
                    : genBusy
                      ? "正在生成…"
                      : "尚未生成"}
                </span>
              </div>
              <div className="card-body">
                {genBusy && genProgress ? (
                  <div style={{ marginBottom: "var(--sp-3)" }}>
                    <Callout tone="info" title="正在生成">
                      模型正在出题，已回 {genProgress.done} 道（目标 {genProgress.requested} 道）。
                      题目会一道道落进候选题队列，不用等整批出完。
                    </Callout>
                    <Meter
                      value={genProgress.done}
                      max={genProgress.requested}
                      label="生成进度"
                    />
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">题干</th>
                        <th scope="col">题号</th>
                        <th scope="col">结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genItems.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="empty">
                              <span className="empty-title">
                                {genBusy ? "模型正在出题…" : "模型没有给出题目"}
                              </span>
                              <span className="empty-body">
                                {genBusy ? "出好一道就会出现在这里。" : "换一下出题要求再试一次。"}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        genItems.map((item) => (
                          <tr key={item.index}>
                            <td className="num">{item.index}</td>
                            <td>{item.stem ?? "—"}</td>
                            <td>{item.code ?? "—"}</td>
                            <td>
                              {item.succeeded ? (
                                <Badge tone="ok">已成候选题</Badge>
                              ) : (
                                <Badge tone="danger">未通过</Badge>
                              )}
                              {item.errors.length > 0 ? (
                                <div className="text-xs" style={{ color: "var(--c-danger)" }}>
                                  {item.errors.join("；")}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: "var(--sp-4)" }}>
                  <span className="text-sm text-3">
                    通过校验的题已经是草稿候选题，在「候选题」标签页审核后发布。
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {activeBatch || serverImport ? (
            <section className="card" style={{ marginTop: "var(--sp-4)" }}>
              <div className="card-head">
                <h2 className="card-title">
                  {produceMode === "import" ? "解析预览" : "生成结果预览"}
                </h2>
                <span className="text-sm text-3">
                  {activeBatch
                    ? `${activeBatch.id} · ${activeBatch.createdAt}`
                    : `${serverImport?.batch.id} · ${serverImport?.batch.createdAt}`}
                </span>
              </div>
              <div className="card-body">
                {produceMode === "import" && (parsed || serverImport) ? (
                  <div className="filter-block">
                    <div className="filter-group-label">列映射</div>
                    {mappingLocked ? (
                      <p className="section-note">
                        这个批次是重新打开的：文件表头只在解析当场拿得到，
                        服务端没有存，所以现在改不了列映射——
                        要改得重新上传原文件。
                      </p>
                    ) : null}
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">字段</th>
                            <th scope="col">来源列</th>
                            <th scope="col">必填</th>
                          </tr>
                        </thead>
                        <tbody>
                          {IMPORT_FIELDS.map((field) => (
                            <tr key={field.key}>
                              <td>{field.label}</td>
                              <td>
                                <SelectInput
                                  aria-label={`${field.label}来源列`}
                                  value={mapping[field.key] ?? ""}
                                  disabled={mappingLocked}
                                  onChange={(event) =>
                                    handleMappingChange(field.key, event.target.value)
                                  }
                                >
                                  <option value="">（不映射）</option>
                                  {(parsed?.headers ?? serverImport?.headers ?? []).map((header) => (
                                    <option key={header} value={header}>
                                      {header}
                                    </option>
                                  ))}
                                </SelectInput>
                              </td>
                              <td>{field.required ? "是" : "否"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">题干</th>
                        <th scope="col">题型</th>
                        <th scope="col">分值</th>
                        <th scope="col">答案</th>
                        <th scope="col">标签</th>
                        <th scope="col">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <span className="empty-title">没有可采纳的解析结果</span>
                              <span className="empty-body">请检查列映射后重新解析。</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        previewRows.map((row) => (
                          <tr key={row.no}>
                            <td className="num">{row.no}</td>
                            <td>
                              <div>{row.stem}</div>
                              {row.valid ? null : (
                                <div className="text-xs" style={{ color: "var(--c-danger)" }}>
                                  {(row as { error?: string }).error ?? "该行有问题"}
                                </div>
                              )}
                            </td>
                            <td>
                              <TypeBadge type={row.type} />
                            </td>
                            <td className="num">{row.score || 5}</td>
                            <td>{row.answer.join("")}</td>
                            <td>
                              <TagChips tags={row.tags} limit={3} catalog={tags} />
                            </td>
                            <td>
                              {row.valid ? (
                                <Badge tone="ok">可采纳</Badge>
                              ) : (
                                <Badge tone="danger">有问题</Badge>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: "var(--sp-4)" }}>
                  <Button variant="primary" onClick={() => void handleAdopt()}>
                    <Icon name="check" />
                    采纳为候选题
                  </Button>
                  <span className="text-sm text-3">
                    采纳后题目进入草稿状态，需在候选题队列审核发布。
                  </span>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <QuestionEditor
        open={editorOpen}
        question={editingQuestion}
        onClose={() => setEditorOpen(false)}
        onSave={questionQuery.save}
        catalogTags={tags}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.status === "draft" ? "丢弃候选题" : "删除题目"}
        message={
          pendingDelete?.status === "draft"
            ? `将丢弃题目 ${pendingDelete.id}：${pendingDelete.stem}。丢弃后不可恢复。`
            : `将删除题目 ${pendingDelete?.id ?? ""}：${pendingDelete?.stem ?? ""}。题库、试卷与练习中的引用会自动跳过此题，操作不可撤销。`
        }
        confirmText={pendingDelete?.status === "draft" ? "确认丢弃" : "确认删除"}
        confirmVariant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          void (async () => {
            try {
              await questionQuery.remove(pendingDelete.id);
              toast.ok(`已删除题目 ${pendingDelete.code ?? pendingDelete.id}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "删除失败");
            }
            setPendingDelete(null);
          })();
        }}
      />

      <ConfirmDialog
        open={pendingBatchDiscard !== null}
        title="批量丢弃候选题"
        message={`将丢弃 ${pendingBatchDiscard ?? 0} 道候选题，丢弃后不可恢复。`}
        confirmText="确认丢弃"
        confirmVariant="danger"
        onCancel={() => setPendingBatchDiscard(null)}
        onConfirm={() => void confirmBatchDiscard()}
      />
    </>
  );
}
