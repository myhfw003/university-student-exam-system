/* ==========================================================================
   知行测评 · 管理端题库工作台
   --------------------------------------------------------------------------
   对应原型 admin.bank。三个标签页：
     题目      —— 管理题目状态（发布 / 停用 / 恢复）
     候选题    —— 审核导入与 AI 生成的草稿题目
     内容生产  —— CSV 导入与 AI 生成（均产出草稿候选题）
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Field,
  PageHead,
  SearchInput,
  Segmented,
  SelectInput,
  Stat,
  Tabs,
  TagFilter,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import {
  bankStats,
  commitGeneration,
  commitImport,
  createGeneration,
  createImportBatch,
  discardQuestion,
  discardQuestions,
  removeQuestion,
  setQuestionStatus,
  setQuestionsStatus,
  updateImportBatch,
  useCatalog,
} from "@exam/shared/mock/catalog";
import type { Question } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { DifficultyChip, SourceBadge, StatusBadge, TagChips, TypeBadge } from "../shared/bits";
import { QuestionEditor } from "../shared/QuestionEditor";
import { TagPicker } from "../shared/TagPicker";
import {
  IMPORT_FIELDS,
  buildImportRows,
  guessMapping,
  parseImportFile,
  type ColumnMapping,
  type ParsedTable,
} from "./importFile";

/** 工作台标签页。 */
type WorkbenchTab = "questions" | "candidates" | "produce";

/** 题库工作台。 */
export function BankWorkbenchPage() {
  const { bankId = "__all__" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as WorkbenchTab) || "questions";
  const banks = useCatalog((state) => state.banks);
  const questions = useCatalog((state) => state.questions);
  const tags = useCatalog((state) => state.tags);
  const imports = useCatalog((state) => state.imports);
  const generations = useCatalog((state) => state.generations);

  const bank = banks.find((b) => b.id === bankId) ?? null;
  const title = !bankId || bankId === "__all__" ? "全部题库" : (bank?.name ?? "全部题库");
  const stats = bankStats(bankId);

  // 题目筛选。
  const [statusFilter, setStatusFilter] = useState<"published" | "draft" | "disabled" | "全部">(
    "published",
  );
  const [typeFilter, setTypeFilter] = useState("全部");
  const [keyword, setKeyword] = useState("");
  // 标签筛选（原型：领域 + 能力两组 chip，多选为「任一命中」）。
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  // 候选题筛选与选择。
  const [sourceFilter, setSourceFilter] = useState("全部");
  const [picked, setPicked] = useState<string[]>([]);

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
  const [targetBank, setTargetBank] = useState(bankId === "__all__" ? (banks[0]?.id ?? "") : bankId);
  const [genType, setGenType] = useState("single");
  const [genCount, setGenCount] = useState(3);
  const [genDifficulty, setGenDifficulty] = useState("中等");
  const [genPrompt, setGenPrompt] = useState("");
  const [genTags, setGenTags] = useState<string[]>([]);
  const [batchId, setBatchId] = useState("");

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  /* ----------------------------------------------------------- 题目列表 */

  const questionList = useMemo(() => {
    // 直接从 questions 派生，保证依赖真实、变更时能重算。
    const bank = banks.find((b) => b.id === bankId);
    const list =
      !bankId || bankId === "__all__"
        ? questions
        : (bank?.questionIds ?? [])
            .map((qid) => questions.find((q) => q.id === qid))
            .filter((q): q is Question => Boolean(q));
    return list.filter((q) => {
      if (statusFilter !== "全部" && q.status !== statusFilter) return false;
      if (typeFilter !== "全部" && q.type !== typeFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${q.id} ${q.stem}`.toLowerCase().includes(kw)) return false;
      }
      // 多个标签之间为「任一命中」（与原型一致）。
      if (tagFilter.length && !tagFilter.some((tagId) => q.tags.includes(tagId))) return false;
      return true;
    });
  }, [bankId, banks, statusFilter, typeFilter, keyword, tagFilter, questions]);

  /* ----------------------------------------------------------- 候选题列表 */

  const candidateAll = useMemo(() => {
    const bank = banks.find((b) => b.id === bankId);
    const list =
      !bankId || bankId === "__all__"
        ? questions
        : (bank?.questionIds ?? [])
            .map((qid) => questions.find((q) => q.id === qid))
            .filter((q): q is Question => Boolean(q));
    return list.filter((q) => q.status === "draft");
  }, [bankId, banks, questions]);

  const candidateList = useMemo(
    () =>
      candidateAll.filter((q) => {
        if (sourceFilter !== "全部" && (q.source ?? "manual") !== sourceFilter) return false;
        return true;
      }),
    [candidateAll, sourceFilter],
  );

  /* ----------------------------------------------------------- 内容生产 */

  const activeBatch = useMemo(() => {
    if (!batchId) return null;
    if (produceMode === "import") return imports.find((b) => b.id === batchId) ?? null;
    return generations.find((b) => b.id === batchId) ?? null;
  }, [batchId, produceMode, imports, generations]);

  /** 选文件 → 真实解析（.csv / .xlsx）。 */
  const handleFilePick = async (file: File | null): Promise<void> => {
    if (!file) return;
    setParseError(null);
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

  /** 解析结果（随列映射实时重算）。 */
  const previewRows = useMemo(
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
      rows: previewRows.map((row) => ({
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
    const bad = previewRows.filter((row) => !row.valid).length;
    toast.ok(
      bad > 0
        ? `解析完成，共 ${result.batch.rowCount} 行待确认，其中 ${bad} 行有问题，请修正列映射`
        : `解析完成，共 ${result.batch.rowCount} 行待确认`,
    );
  };

  const handleGenerate = () => {
    const result = createGeneration({
      count: genCount,
      type: genType as "single",
      difficulty: genDifficulty,
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

  const handleAdopt = () => {
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

  const handleStatus = (question: Question, status: Question["status"]) => {
    const result = setQuestionStatus(question.id, status);
    if (!result.ok) {
      toast.error(result.message ?? "状态更新失败");
      return;
    }
    toast.ok(
      status === "published"
        ? `题目 ${question.id} 已发布`
        : status === "disabled"
          ? `题目 ${question.id} 已停用`
          : `题目 ${question.id} 已转为草稿`,
    );
  };

  const handleDiscard = (question: Question) => {
    const result = discardQuestion(question.id);
    if (!result.ok) {
      toast.error(result.message ?? "丢弃失败");
      return;
    }
    toast.ok(`已丢弃 ${question.id}`);
    setPendingDelete(null);
  };

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const batchPublish = () => {
    if (picked.length === 0) {
      toast.error("请先选择候选题");
      return;
    }
    const result = setQuestionsStatus(picked, "published");
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

  const confirmBatchDiscard = () => {
    const result = discardQuestions(picked);
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
                  { value: "全部", label: "全部" },
                ]}
              />
              <SelectInput
                aria-label="题型筛选"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="全部">全部题型</option>
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
                        <td className="text-xs mono">{q.id}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{q.stem}</div>
                          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                            <TypeBadge type={q.type} />
                            <DifficultyChip tags={q.tags} />
                            <TagChips tags={q.tags} limit={3} />
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
                            onClick={() => {
                              setEditingQuestion(q);
                              setEditorOpen(true);
                            }}
                          >
                            编辑
                          </Button>{" "}
                          {q.status === "published" ? (
                            <Button size="sm" onClick={() => handleStatus(q, "disabled")}>
                              停用
                            </Button>
                          ) : q.status === "disabled" ? (
                            <Button size="sm" onClick={() => handleStatus(q, "published")}>
                              恢复
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => handleStatus(q, "published")}
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
                <Button size="sm" variant="primary" onClick={batchPublish}>
                  <Icon name="check" />
                  批量发布
                </Button>
                <Button size="sm" variant="danger" onClick={batchDiscard}>
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
                            aria-label={`选择 ${q.id}`}
                            onChange={() => togglePick(q.id)}
                          />
                        </td>
                        <td className="text-xs mono">{q.id}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{q.stem}</div>
                          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                            <TypeBadge type={q.type} />
                            <DifficultyChip tags={q.tags} />
                            <TagChips tags={q.tags} limit={3} />
                          </div>
                        </td>
                        <td>
                          <SourceBadge source={q.source} />
                        </td>
                        <td className="text-xs text-3">{q.batchId ?? "—"}</td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditingQuestion(q);
                              setEditorOpen(true);
                            }}
                          >
                            编辑
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleStatus(q, "published")}
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
                  { value: "gen", label: "AI 生成" },
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
                        value={genDifficulty}
                        onChange={(event) => setGenDifficulty(event.target.value)}
                      >
                        <option value="基础">基础</option>
                        <option value="中等">中等</option>
                        <option value="较难">较难</option>
                      </SelectInput>
                    </Field>
                  </div>
                )}
              </div>

              {produceMode === "gen" ? (
                <div style={{ marginTop: "var(--sp-4)" }}>
                  <Field
                    label="知识点标签"
                    hint="标签决定生成题目的归类与难度层级，最多 5 个。"
                  >
                    <TagPicker
                      selected={genTags}
                      onToggle={(tagId) =>
                        setGenTags((prev) =>
                          prev.includes(tagId)
                            ? prev.filter((t) => t !== tagId)
                            : [...prev, tagId],
                        )
                      }
                      groups={["domain", "knowledge_point"]}
                      label="知识点标签"
                    />
                  </Field>
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <Field label="生成指令" htmlFor="gen-prompt">
                      <TextArea
                        id="gen-prompt"
                        value={genPrompt}
                        placeholder="例如 围绕 TCP 三次握手与四次挥手生成单选题"
                        onChange={(event) => setGenPrompt(event.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: "var(--sp-4)" }}>
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
              </div>

              <div className="row" style={{ marginTop: "var(--sp-5)" }}>
                {produceMode === "import" ? (
                  <Button variant="primary" onClick={handleParse}>
                    <Icon name="document" />
                    解析文件
                  </Button>
                ) : (
                  <Button variant="primary" onClick={handleGenerate}>
                    <Icon name="flag" />
                    生成候选题
                  </Button>
                )}
                <span className="text-sm text-3">
                  {produceMode === "import"
                    ? "解析为真实文件解析：逐行校验，错误行标红并给出原因，不阻断整批。"
                    : "生成结果为示例数据，不接入真实大模型。"}
                </span>
              </div>
            </div>
          </section>

          {activeBatch ? (
            <section className="card" style={{ marginTop: "var(--sp-4)" }}>
              <div className="card-head">
                <h2 className="card-title">
                  {produceMode === "import" ? "解析预览" : "生成结果预览"}
                </h2>
                <span className="text-sm text-3">
                  {activeBatch.id} · {activeBatch.createdAt}
                </span>
              </div>
              <div className="card-body">
                {produceMode === "import" && parsed ? (
                  <div className="filter-block">
                    <div className="filter-group-label">列映射</div>
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
                                  onChange={(event) =>
                                    handleMappingChange(field.key, event.target.value)
                                  }
                                >
                                  <option value="">（不映射）</option>
                                  {parsed.headers.map((header) => (
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
                      {activeBatch.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <span className="empty-title">没有可采纳的解析结果</span>
                              <span className="empty-body">请检查列映射后重新解析。</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        activeBatch.rows.map((row) => (
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
                              <TagChips tags={row.tags} limit={3} />
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
                  <Button variant="primary" onClick={handleAdopt}>
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
          if (pendingDelete.status === "draft") {
            handleDiscard(pendingDelete);
            return;
          }
          const result = removeQuestion(pendingDelete.id);
          if (!result.ok) {
            toast.error(result.message ?? "删除失败");
          } else {
            toast.ok(`已删除题目 ${pendingDelete.id}`);
          }
          setPendingDelete(null);
        }}
      />

      <ConfirmDialog
        open={pendingBatchDiscard !== null}
        title="批量丢弃候选题"
        message={`将丢弃 ${pendingBatchDiscard ?? 0} 道候选题，丢弃后不可恢复。`}
        confirmText="确认丢弃"
        confirmVariant="danger"
        onCancel={() => setPendingBatchDiscard(null)}
        onConfirm={confirmBatchDiscard}
      />
    </>
  );
}
