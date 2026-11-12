/* ==========================================================================
   知行测评 · 管理端组卷向导（四步）
   --------------------------------------------------------------------------
   对应原型 admin.paper。步骤：
     基本信息 → 选题与配分 → 卷型与梅花卷 → 名单与发布

   与原型的差异：**新增「一键出卷」**（docs/design/03-domain-model.md §4.2）。
   原型只能手工勾选 + 套模板；本实现按配额矩阵确定性抽题，池量不足即报错并
   列出缺口（不静默降级），生成后仍可手工微调。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  Callout,
  ConfirmDialog,
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
  TAG_GROUP_ORDER,
  className as classNameOf,
  createExam,
  createPractice,
  difficultyLevels,
  getQuestion,
  itemsOf,
  plumCfgOf,
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
import type { ExamPaper, PaperItem, Practice } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { DifficultyChip, TypeBadge } from "../shared/bits";
import { scopeLabel, sumScore } from "../shared/scope";
import { PaperPreviewTable } from "../shared/PaperPreviewTable";

/** 向导步骤。 */
type Step = "basic" | "select" | "plum" | "publish";

const STEPS: Array<{ key: Step; label: string; hint: string }> = [
  { key: "basic", label: "基本信息", hint: "名称、时长与分值" },
  { key: "select", label: "选题与配分", hint: "选题并设定每题分值" },
  { key: "plum", label: "卷型与梅花卷", hint: "标准 / 小梅花 / 大梅花" },
  { key: "publish", label: "名单与发布", hint: "考试名单与发布校验" },
];

const QUESTION_TYPE_OPTIONS = [
  { value: "single", label: "单选题" },
  { value: "multi", label: "多选题" },
  { value: "judge", label: "判断题" },
  { value: "short", label: "简答题" },
  { value: "comprehensive", label: "综合操作题" },
];

/** 组卷向导。 */
export function PaperWizardPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const kind = (params.get("kind") as "exam" | "practice") || "exam";
  const step = (params.get("step") as Step) || "basic";

  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);
  const questions = useCatalog((state) => state.questions);
  const classes = useCatalog((state) => state.classes);
  const templates = useCatalog((state) => state.paperTemplates);

  // 新建：先落库再跳转，避免向导里出现「没有对象」的中间态。
  useEffect(() => {
    if (paperId !== "new") return;
    if (kind === "exam") {
      const result = createExam({ name: "新建试卷", scope: [], orderRule: "type" });
      if (!result.ok || !result.exam) {
        toast.error(result.message ?? "创建失败");
        return;
      }
      navigate(`/papers/${result.exam.id}?kind=exam&step=basic`, { replace: true });
      return;
    }
    const result = createPractice({ name: "新建练习", scope: [], orderRule: "type" });
    if (!result.ok || !result.practice) {
      toast.error(result.message ?? "创建失败");
      return;
    }
    navigate(`/papers/${result.practice.id}?kind=practice&step=basic`, { replace: true });
  }, [paperId, kind, navigate]);

  const item = kind === "exam" ? exams.find((e) => e.id === paperId) : practices.find((p) => p.id === paperId);

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
    if (!item || hydrated) return;
    setName(item.name);
    if (kind === "exam") {
      const exam = item as ExamPaper;
      setBatch(exam.batch ?? "");
      setNote(exam.note ?? "");
      setDurationMin(exam.durationMin || 60);
      setTotalScore(exam.totalScore || 0);
      setPassScore(exam.passScore || 0);
      setOpenAt(exam.openAt ?? "");
      setCloseAt(exam.closeAt ?? "");
      setAllowRetake(exam.allowRetake ?? false);
      setPublishAnswer(exam.publishAnswer ?? "after_close");
    } else {
      const practice = item as Practice;
      setNote(practice.note ?? "");
      setDurationMin(practice.durationMin || 20);
      setRepeats(practice.repeats ?? 0);
      setFeedback(practice.feedback ?? "after_submit");
      setMistakeReflow(practice.mistakeReflow ?? true);
    }
    setOrderRule(item.orderRule);
    setScope([...item.scope]);
    setHydrated(true);
  }, [item, kind, hydrated]);

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

  /* ------------------------------------------------------- 卷面预览状态 */

  const [previewStudent, setPreviewStudent] = useState("");

  const items = useMemo(() => (item ? itemsOf(item) : []), [item]);
  const total = sumScore(items);

  const available = useMemo(
    () => publishedQuestionIds(questions.map((q) => q.id)).map((id) => getQuestion(id)).filter((q): q is NonNullable<typeof q> => Boolean(q)),
    [questions],
  );

  const filtered = useMemo(() => {
    const pickedIds = items.map((i) => i.qid);
    return available.filter((q) => {
      if (bankFilter.length > 0) {
        const inBank = useCatalog
          .getState()
          .banks.some((b) => bankFilter.includes(b.id) && b.questionIds.includes(q.id));
        if (!inBank) return false;
      }
      if (typeFilter.length > 0 && !typeFilter.includes(q.type)) return false;
      if (tagFilter.length > 0 && !q.tags.some((t) => tagFilter.includes(t))) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${q.id} ${q.stem}`.toLowerCase().includes(kw)) return false;
      }
      return !pickedIds.includes(q.id);
    });
  }, [available, items, bankFilter, typeFilter, tagFilter, keyword]);

  const pickedList = useMemo(() => {
    if (!item) return [];
    const byQid = new Map(items.map((i) => [i.qid, i]));
    const ordered = canonicalOrder(item, getQuestion, difficultyLevels());
    return ordered.map((qid, index) => {
      const picked = byQid.get(qid) ?? { qid, score: 0 };
      return { ...picked, index: index + 1, question: getQuestion(qid) };
    });
  }, [item, items]);

  /* ------------------------------------------------------------ 动作 */

  const goStep = (next: Step) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("kind", kind);
    nextParams.set("step", next);
    setParams(nextParams);
  };

  const saveBasic = () => {
    if (!item) return;
    const ok =
      kind === "exam"
        ? setExamMeta(item.id, {
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
          }).ok
        : setPracticeMeta(item.id, {
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
    toast.ok("基本信息已保存");
    goStep("select");
  };

  const togglePick = (qid: string) => {
    if (!item) return;
    const next: PaperItem[] = items.some((i) => i.qid === qid)
      ? items.filter((i) => i.qid !== qid)
      : [...items, { qid, score: getQuestion(qid)?.score ?? 5 }];
    const result = setPaperItems(kind, item.id, next);
    if (!result.ok) toast.error(result.message ?? "保存失败");
  };

  const setScore = (qid: string, score: number) => {
    if (!item) return;
    const next = items.map((i) => (i.qid === qid ? { ...i, score } : i));
    const result = setPaperItems(kind, item.id, next);
    if (!result.ok) toast.error(result.message ?? "保存失败");
  };

  const removePick = (qid: string) => {
    if (!item) return;
    const result = setPaperItems(
      kind,
      item.id,
      items.filter((i) => i.qid !== qid),
    );
    if (!result.ok) toast.error(result.message ?? "保存失败");
  };

  /** 按题量均分。 */
  const evenScores = () => {
    if (!item || items.length === 0) return;
    const base = Math.floor((totalScore || total) / items.length);
    const result = setPaperItems(
      kind,
      item.id,
      items.map((it) => ({ qid: it.qid, score: base })),
    );
    if (result.ok) toast.ok(`已按 ${items.length} 题均分为 ${base} 分`);
  };

  /** 对齐目标总分：余数逐项补齐，总和精确等于目标。 */
  const alignScores = () => {
    if (!item || items.length === 0) return;
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
    const result = setPaperItems(kind, item.id, out);
    if (result.ok) toast.ok(`配分已对齐到 ${target} 分`);
  };

  /** 一键出卷：按配额矩阵确定性抽题。 */
  const runBlueprint = () => {
    if (!item) return;
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

    const pool = available.filter((q) =>
      bpTagIds.length === 0 ? true : q.tags.some((t) => bpTagIds.includes(t)),
    );

    try {
      const result = selectQuestions(rules, pool, autoSeed(item.id), difficultyLevels());
      const saved = setPaperItems(kind, item.id, result.items);
      if (!saved.ok) {
        toast.error(saved.message ?? "保存失败");
        return;
      }
      setBpShortfall([]);
      setBlueprintOpen(false);
      toast.ok(`已生成 ${result.itemCount} 题，合计 ${result.totalScore} 分`);
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

  /** 套用卷型模板。 */
  const applyTemplate = (templateId: string) => {
    if (!item) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    const result = setPaperItems(kind, item.id, template.items);
    if (!result.ok) {
      toast.error(result.message ?? "套用失败");
      return;
    }
    toast.ok(`已套用模板「${template.name}」`);
  };

  const saveAsTemplate = (templateName: string) => {
    if (!item) return;
    const result = savePaperTemplate({
      name: templateName,
      kind,
      mode: kind === "exam" ? plumCfgOf(item.id).mode : "fixed",
      durationMin,
      passScore: kind === "exam" ? passScore : 0,
      items,
    });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok("已保存为卷型模板");
  };

  const setMode = (mode: "standard" | "small" | "large") => {
    if (!item) return;
    setPlumCfg(item.id, { mode });
    toast.ok(`卷型已切换为${PAPER_MODES[mode].label}`);
  };

  const publish = () => {
    if (!item) return;
    const check = preflight(kind, item.id);
    if (!check.ok) {
      toast.error(`发布校验未通过，${check.failed} 项待修正`);
      return;
    }
    const ok =
      kind === "exam"
        ? setExamMeta(item.id, { status: "ongoing", published: true }).ok
        : setPracticeMeta(item.id, { status: "published", published: true }).ok;
    if (!ok) {
      toast.error("发布失败");
      return;
    }
    toast.ok(kind === "exam" ? "考试已发布" : "练习已上架");
  };

  const unpublish = () => {
    if (!item) return;
    const ok =
      kind === "exam"
        ? setExamMeta(item.id, { status: "draft", published: false }).ok
        : setPracticeMeta(item.id, { status: "draft", published: false }).ok;
    if (!ok) {
      toast.error("撤回失败");
      return;
    }
    toast.ok(kind === "exam" ? "已撤回发布" : "已下架");
  };

  /* ------------------------------------------------------------ 渲染 */

  if (!item) {
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

  const currentIndex = STEPS.findIndex((s) => s.key === step);
  const published = kind === "exam"
    ? (item as ExamPaper).status !== "draft" && (item as ExamPaper).published
    : (item as Practice).status === "published";
  const check = preflight(kind, item.id);
  const scopeStudents = useCatalog.getState().students.filter(
    (s) => scope.length === 0 || scope.includes(s.classId),
  );

  return (
    <>
      <PageHead
        title={item.name}
        sub={`${kind === "exam" ? "考试卷" : "练习"} · ${(item as ExamPaper).batch || item.note || "尚未填写说明"} · 第 ${currentIndex + 1} / ${STEPS.length} 步`}
        actions={
          <>
            <Button onClick={() => navigate(`/papers?kind=${kind}`)}>返回列表</Button>
          </>
        }
      />

      <ol className="steps">
        {STEPS.map((s, index) => {
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
            <span className="text-sm text-3">{scopeLabel(scope, classNameOf)}</span>
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
                  <Field label="开考时间" htmlFor="wiz-open">
                    <TextInput
                      id="wiz-open"
                      value={openAt}
                      placeholder="2026-11-09 08:30"
                      onChange={(e) => setOpenAt(e.target.value)}
                    />
                  </Field>
                </div>
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

            <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
              {kind === "exam" ? "考试名单" : "开放范围"}
            </h3>
            <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
              {classes.map((c) => {
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
          </div>
          <div className="card-foot">
            <Button variant="primary" onClick={saveBasic}>
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
                <SelectInput
                  aria-label="题库筛选"
                  value={bankFilter[0] ?? ""}
                  onChange={(e) => setBankFilter(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">全部题库</option>
                  {useCatalog.getState().banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </SelectInput>
                <SelectInput
                  aria-label="题型筛选"
                  value={typeFilter[0] ?? ""}
                  onChange={(e) => setTypeFilter(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">全部题型</option>
                  {QUESTION_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </SelectInput>
                <SearchInput
                  label="搜索题号或题干"
                  value={keyword}
                  placeholder="搜索题号或题干"
                  onSearch={setKeyword}
                  onChange={setKeyword}
                />
              </div>
              <div className="filter-block">
                <div className="filter-group-label">标签筛选</div>
                <div className="row-tight">
                  {TAG_GROUP_ORDER.flatMap((group) =>
                    useCatalog
                      .getState()
                      .tags.filter((t) => t.group === group)
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
                        onChange={() => togglePick(q.id)}
                      />
                      <span className="pick-id mono">{q.id}</span>
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
                hint={
                  orderRule === "type"
                    ? "按题型分块、组内由易到难。下列序号是出卷的基础题序。"
                    : "按选题顺序出卷，完全人工指定。"
                }
              >
                <SelectInput
                  id="wiz-order-rule"
                  value={orderRule}
                  onChange={(e) => {
                    const next = e.target.value as "type" | "manual";
                    setOrderRule(next);
                    if (kind === "exam") setExamMeta(item.id, { orderRule: next });
                    else setPracticeMeta(item.id, { orderRule: next });
                  }}
                >
                  <option value="type">按题型分块</option>
                  <option value="manual">人工指定</option>
                </SelectInput>
              </Field>

              <div className="row" style={{ margin: "var(--sp-3) 0" }}>
                <Button size="sm" onClick={evenScores}>
                  按题量均分
                </Button>
                <Button size="sm" onClick={alignScores}>
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
                        onChange={(e) => setScore(p.qid, Number(e.target.value) || 0)}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`移除 ${p.qid}`}
                        onClick={() => removePick(p.qid)}
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
                {templates.filter((t) => t.kind === kind).length > 0 ? (
                  <>
                    <SelectInput
                      id="wiz-tpl"
                      aria-label="卷型模板"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) applyTemplate(e.target.value);
                      }}
                    >
                      <option value="">选择卷型模板…</option>
                      {templates
                        .filter((t) => t.kind === kind)
                        .map((t) => (
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
                    saveAsTemplate(templateName);
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
                <Callout tone="info" title="练习卷按固定顺序组卷">
                  练习卷面向单个答题者的巩固训练，题序按第 2 步选定的题序规则排布，选项顺序固定，不生成梅花卷变体；需要变式训练时可在题库中维护多套练习。
                </Callout>
                <dl className="kv" style={{ marginTop: "var(--sp-5)" }}>
                  <dt>题量</dt>
                  <dd>{items.length} 道</dd>
                  <dt>题序规则</dt>
                  <dd>{orderRule === "type" ? "按题型分块" : "人工指定"}</dd>
                  <dt>总分</dt>
                  <dd>{total} 分</dd>
                  <dt>时长</dt>
                  <dd>{durationMin} 分钟</dd>
                  <dt>开放范围</dt>
                  <dd>{scopeLabel(scope, classNameOf)}</dd>
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
                    {(["standard", "small", "large"] as const).map((mode) => {
                      const on = plumCfgOf(item.id).mode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          className={`mode-card${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => setMode(mode)}
                        >
                          <span className="mode-name">{PAPER_MODES[mode].label}</span>
                          <span className="mode-desc">{PAPER_MODES[mode].desc}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid-2" style={{ marginTop: "var(--sp-5)" }}>
                    <div className="field">
                      <span className="field-label">题序规则</span>
                      <div className="text-sm text-3">
                        {orderRule === "type" ? "按题型分块" : "人工指定"}（第 2 步设定）
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">卷面生成方式</span>
                      <div className="text-sm text-3">
                        {plumCfgOf(item.id).mode === "standard"
                          ? "固定卷面，全体一致"
                          : plumCfgOf(item.id).mode === "small"
                            ? "题序统一，逐人打乱选项"
                            : "题型分块保留，组内题序与选项逐人打乱"}
                      </div>
                    </div>
                  </div>

                  <Callout tone="info" title="置换口径">
                    {plumCfgOf(item.id).mode === "standard"
                      ? "标准卷不生成变体，全体答题者共用同一份卷面。"
                      : `当前名单 ${scopeStudents.length} 名答题者 → 共 ${scopeStudents.length} 种不同卷面。`}{" "}
                    置换种子由系统按试卷自动生成，无需手工设置；同一试卷重复出卷结果一致，可随时复核。判断题固定不参与选项置换。
                  </Callout>
                </div>
              </section>

              <section className="card" style={{ marginTop: "var(--sp-4)" }}>
                <div className="card-head">
                  <h2 className="card-title">答题者卷面预览</h2>
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
                </div>
                <div className="card-body">
                  {items.length === 0 ? (
                    <div className="empty">
                      <span className="empty-title">尚未选题</span>
                      <span className="empty-body">先在第 2 步选题，再回到这里预览卷面。</span>
                    </div>
                  ) : (
                    (() => {
                      const studentId = previewStudent || scopeStudents[0]?.id || "2023120101";
                      const paper = buildPaper(
                        item as ExamPaper,
                        studentId,
                        undefined,
                        getQuestion,
                        difficultyLevels(),
                      );
                      return (
                        <>
                          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                            <span className="variant-tag">{paper.variantLabel}</span>
                            <span className="text-sm text-3">
                              卷型 {PAPER_MODES[paper.mode].label} · 置换号 {paper.seedLabel}（系统自动生成）
                            </span>
                          </div>
                          <PaperPreviewTable
                            paper={paper}
                            showBase={paper.mode === "large"}
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
                  <Field label="答案公布时机" htmlFor="wiz-publish-answer">
                    <SelectInput
                      id="wiz-publish-answer"
                      value={publishAnswer}
                      onChange={(e) => setPublishAnswer(e.target.value)}
                    >
                      <option value="after_close">考试结束后公布</option>
                      <option value="after_submit">交卷后立即公布</option>
                      <option value="on_open">开考即公布</option>
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
                <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
                  {classes.map((c) => {
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
                          setExamMeta(item.id, { scope: next });
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
            ) : (
              <>
                <h3 className="section-title">开放范围</h3>
                <div className="row-tight" style={{ marginTop: "var(--sp-3)" }}>
                  {classes.map((c) => {
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
                          setPracticeMeta(item.id, { scope: next });
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

            <h3 className="section-title" style={{ marginTop: "var(--sp-5)" }}>
              发布前校验
            </h3>
            <div style={{ marginTop: "var(--sp-3)" }}>
              <ul className="checklist">
                {check.checks.map((c) => (
                  <li className={`check-item ${c.ok ? "is-ok" : "is-bad"}`} key={c.key}>
                    <span className="check-mark" aria-hidden="true">
                      <Icon name={c.ok ? "check" : "close"} />
                    </span>
                    <span className="check-text">
                      <span className="check-label">{c.label}</span>
                      <span className="check-detail">{c.detail}</span>
                    </span>
                    <span className="check-state">{c.ok ? "通过" : "未通过"}</span>
                  </li>
                ))}
              </ul>
              <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                共 {check.total} 项检查，
                {check.failed
                  ? `其中 ${check.failed} 项未通过，需修正后才能发布。`
                  : "全部通过，可以发布。"}
              </p>
            </div>

            {!check.ok ? (
              <Callout tone="warn" title="存在未通过的校验项">
                请先修正上述问题，发布按钮在全部校验通过后才会启用。
              </Callout>
            ) : null}
          </div>
          <div className="card-foot">
            <Button onClick={() => goStep("plum")}>上一步 · 卷型</Button>{" "}
            {published ? (
              <Button onClick={unpublish}>{kind === "exam" ? "撤回发布" : "下架"}</Button>
            ) : (
              <Button variant="primary" disabled={!check.ok} onClick={publish}>
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
                  {useCatalog
                    .getState()
                    .tags.filter((t) => t.group === "difficulty")
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
                    useCatalog
                      .getState()
                      .tags.filter((t) => t.group === group)
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
        onConfirm={runBlueprint}
      />
    </>
  );
}
