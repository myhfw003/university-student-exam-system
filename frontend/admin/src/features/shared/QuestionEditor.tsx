/* ==========================================================================
   知行测评 · 管理端题目编辑器
   --------------------------------------------------------------------------
   原型 admin.js 的 openQuestionEditor + questionEditorHtml + dynamicEditorHtml。

   题型决定下半区的结构：
     单选 / 多选 / 判断 → 选项与答案（判断题固定两项且不参与置换）
     简答             → 评分要点（系统按关键词初判，各要点均分）
     综合操作         → 评分步骤（每步独立判定，按权重等比缩放）
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  Field,
  IconButton,
  SelectInput,
  TextArea,
  TextInput,
  formatFileSize,
  readFileAsDataUrl,
  toast,
  validateAttachment,
} from "@exam/shared";
import { isBackendEnabled, uploadQuestionAttachment } from "@exam/shared/api";
import { upsertQuestion, useCatalog } from "@exam/shared/mock/catalog";
import type {
  Question,
  QuestionAttachment,
  QuestionKeypoint,
  QuestionOption,
  QuestionStep,
  QuestionType,
} from "@exam/shared/domain/types";
import { MAX_TAGS } from "@exam/shared/mock/catalog";
import { TagPicker } from "./TagPicker";
import type { QuestionTag } from "./useCatalogTags";

const TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
  { value: "single", label: "单选题" },
  { value: "multi", label: "多选题" },
  { value: "judge", label: "判断题" },
  { value: "short", label: "简答题" },
  { value: "comprehensive", label: "综合操作题" },
];

/** 新建题目时的默认选项（原型 dynamicEditorHtml 的四项空白）。 */
const DEFAULT_OPTIONS: QuestionOption[] = [
  { key: "A", text: "" },
  { key: "B", text: "" },
  { key: "C", text: "" },
  { key: "D", text: "" },
];

/** 判断题固定两项：正确 / 错误，且不参与梅花卷选项置换。 */
const JUDGE_OPTIONS: QuestionOption[] = [
  { key: "A", text: "正确" },
  { key: "B", text: "错误" },
];

/** 新建题目时的默认评分要点（原型三项空白）。 */
const DEFAULT_KEYPOINTS: QuestionKeypoint[] = [
  { text: "", keywords: [] },
  { text: "", keywords: [] },
  { text: "", keywords: [] },
];

/** 新建题目时的默认评分步骤（原型两步空白）。 */
const DEFAULT_STEPS: QuestionStep[] = [
  { id: "s1", prompt: "", answer: "", keywords: [], score: 5 },
  { id: "s2", prompt: "", answer: "", keywords: [], score: 5 },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "disabled", label: "已停用" },
];

export interface QuestionEditorProps {
  open: boolean;
  /** 待编辑题目；null 表示新建。 */
  question: Question | null;
  onClose: () => void;
  /** 保存成功后回调。 */
  onSaved?: (question: Question) => void;
  /**
   * 保存题目。
   * <para>
   * HTTP 模式由页面传入后端通路（真实后端的题号是 `code`，主键是数字 id）；
   * 缺省时走本地 mock。
   * </para>
   */
  onSave?: (question: Question) => Promise<Question>;
  /**
   * 标签目录。
   *
   * HTTP 模式由页面传入服务端目录（标签 ID 是数字主键）；
   * 缺省时用本地目录。
   */
  catalogTags?: readonly QuestionTag[];
}

/** 题目编辑器对话框。 */
export function QuestionEditor({
  open,
  question,
  onClose,
  onSaved,
  onSave,
  catalogTags,
}: QuestionEditorProps) {
  const remote = isBackendEnabled();
  const [id, setId] = useState("");
  /** 题号：真实后端里题号是独立的 `code`，主键是数字 id。 */
  const [code, setCode] = useState("");
  const [type, setType] = useState<QuestionType>("single");
  const [score, setScore] = useState(5);
  const [status, setStatus] = useState("draft");
  const [tags, setTags] = useState<string[]>([]);
  const [stem, setStem] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [reference, setReference] = useState("");
  const [options, setOptions] = useState<QuestionOption[]>([]);
  const [answer, setAnswer] = useState<string[]>([]);
  const [keypoints, setKeypoints] = useState<QuestionKeypoint[]>([]);
  const [steps, setSteps] = useState<QuestionStep[]>([]);
  // 题目附件（FR-CAT-05）。
  const [attachments, setAttachments] = useState<QuestionAttachment[]>([]);
  /**
   * 待上传的附件文件。
   *
   * HTTP 模式：文件直传服务端的私有桶——题目还没有 ID 时不能带题目 ID 上传，
   * 所以先留在本地，保存题目后再按题目 ID 传上去。
   */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // 切到判断题前的选项与答案，切回来时恢复。
  const judgeStash = useRef<{ options: QuestionOption[]; answer: string[] } | null>(null);

  // 打开时载入题目（新建时用空表单）。
  useEffect(() => {
    if (!open) return;
    if (question) {
      setId(question.id);
      setCode(question.code ?? question.id);
      setType(question.type);
      setScore(question.score);
      setStatus(question.status);
      setTags(question.tags);
      setStem(question.stem);
      setAnalysis(question.analysis);
      setReference(question.reference ?? "");
      setOptions(question.options ?? []);
      setAnswer(question.answer);
      setKeypoints(question.keypoints ?? []);
      setSteps(question.steps ?? []);
      setAttachments(question.attachments ?? []);
    } else {
      setId("");
      setCode("");
      setType("single");
      setScore(5);
      setStatus("draft");
      setTags([]);
      setStem("");
      setAnalysis("");
      setReference("");
      setOptions(DEFAULT_OPTIONS.map((o) => ({ ...o })));
      setAnswer([]);
      setKeypoints(DEFAULT_KEYPOINTS.map((k) => ({ ...k })));
      setSteps(DEFAULT_STEPS.map((s) => ({ ...s })));
      setAttachments([]);
    }
    setPendingFiles([]);
  }, [open, question]);

  /**
   * 切换题型：重建下半区（选项 / 评分要点 / 评分步骤）。
   * 对应原型 admin.js 的 admin.qtype —— 题型决定下半区的结构，
   * 旧的动态数据不能跨题型残留（简答的要点不会带到综合操作题上，
   * 单选的选项不会带到简答上）。
   *
   * 判断题固定「正确 / 错误」两项（原型 admin.js:1038,1043），
   * 切走时把原选项暂存回来，避免白丢用户已填的选项文案。
   */
  const handleTypeChange = (next: QuestionType) => {
    const wasJudge = type === "judge";
    setType(next);

    if (next === "judge") {
      if (!wasJudge) {
        judgeStash.current = { options, answer };
      }
      setOptions(JUDGE_OPTIONS.map((o) => ({ ...o })));
      setAnswer((prev) => prev.filter((key) => key === "A" || key === "B"));
      setKeypoints([]);
      setSteps([]);
      return;
    }

    if (wasJudge) {
      // 从判断题切回：恢复切走前的选项与答案。
      const stash = judgeStash.current;
      judgeStash.current = null;
      if (stash) {
        setOptions(stash.options);
        setAnswer(stash.answer);
      } else {
        setOptions(DEFAULT_OPTIONS.map((o) => ({ ...o })));
        setAnswer([]);
      }
    } else if (next === "single" || next === "multi") {
      // 单选 / 多选：沿用现有选项；单选题只保留一个正确答案。
      setOptions((prev) => (prev.length > 0 ? prev : DEFAULT_OPTIONS.map((o) => ({ ...o }))));
      setAnswer((prev) => (next === "single" ? prev.slice(0, 1) : prev));
    }

    if (next === "short") {
      setKeypoints((prev) => (prev.length > 0 ? prev : DEFAULT_KEYPOINTS.map((k) => ({ ...k }))));
      setSteps([]);
      return;
    }
    setKeypoints([]);
    setSteps((prev) => (prev.length > 0 ? prev : DEFAULT_STEPS.map((st) => ({ ...st }))));
  };

  const toggleTag = (tagId: string) => {
    setTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  };

  const toggleAnswer = (key: string) => {
    if (type === "multi") {
      setAnswer((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
      );
      return;
    }
    setAnswer([key]);
  };

  /** 选附件：校验类型与体积。HTTP 模式先留在本地，保存题目时再传。 */
  const handleAttach = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    if (remote) {
      const next = [...pendingFiles];
      for (const file of Array.from(files)) {
        const check = validateAttachment(file);
        if (!check.ok) {
          setAttachmentError(check.message ?? "附件不可用");
          continue;
        }
        next.push(file);
      }
      setPendingFiles(next);
      return;
    }

    const next = [...attachments];
    for (const file of Array.from(files)) {
      const check = validateAttachment(file);
      if (!check.ok) {
        setAttachmentError(check.message ?? "附件不可用");
        continue;
      }
      const url = await readFileAsDataUrl(file);
      next.push({
        id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        url,
      });
    }
    setAttachments(next);
  };

  const handleSave = async () => {
    const trimmedId = (remote ? code : id).trim();
    const trimmedStem = stem.trim();

    // 题号：必填 + 新建时唯一（原型 admin.js:1010-1015）。
    if (!trimmedId) {
      toast.error("请填写题目编号");
      return;
    }
    if (!trimmedStem) {
      toast.error("请填写题干");
      return;
    }
    // 真实后端按**题号**判重，重复时服务端会明确报错，这里不再自己查一遍。
    if (!remote && !question) {
      const duplicated = useCatalog
        .getState()
        .questions.some((q) => q.id === trimmedId);
      if (duplicated) {
        toast.error(`题号 ${trimmedId} 已存在，请更换`);
        return;
      }
    }

    // 客观题：判断题固定「正确 / 错误」两项（原型 admin.js:1038,1043）。
    const effectiveOptions = type === "judge" ? JUDGE_OPTIONS.map((o) => ({ ...o })) : options;
    const effectiveAnswer = answer.filter((key) =>
      effectiveOptions.some((o) => o.key === key),
    );

    if (type === "single" || type === "multi" || type === "judge") {
      if (effectiveAnswer.length === 0) {
        toast.error("请至少勾选一个正确答案");
        return;
      }
      if (type === "single" && effectiveAnswer.length > 1) {
        toast.error("单选题只能有一个正确答案");
        return;
      }
      if (type === "multi" && effectiveAnswer.length < 2) {
        toast.error("多选题至少需要两个正确答案");
        return;
      }
    }

    if (type === "short") {
      const filled = keypoints.filter((kp) => kp.text.trim());
      if (filled.length === 0) {
        toast.error("请至少填写一个评分要点");
        return;
      }
    }

    if (type === "comprehensive") {
      const filled = steps.filter((st) => st.prompt.trim());
      if (filled.length === 0) {
        toast.error("请至少填写一个评分步骤");
        return;
      }
    }

    const objective = type === "single" || type === "multi" || type === "judge";

    const next: Question = {
      // 真实后端：id 是数字主键（新建时为空），题号放在 code。
      id: remote ? (question?.id ?? "") : trimmedId,
      ...(remote ? { code: trimmedId } : {}),
      type,
      score,
      status: status as Question["status"],
      source: question?.source ?? "manual",
      tags,
      stem: trimmedStem,
      analysis,
      ...(reference.trim() ? { reference } : {}),
      answer: objective ? effectiveAnswer : [],
      ...(objective
        ? { options: effectiveOptions }
        : type === "short"
          ? { keypoints }
          : { steps }),
      ...(question?.batchId ? { batchId: question.batchId } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    try {
      const saved = onSave
        ? await onSave(next)
        : (() => {
            const result = upsertQuestion(next);
            if (!result.ok || !result.question) {
              throw new Error(result.message ?? "保存失败");
            }
            return result.question;
          })();

      // 附件：题目有 ID 了才传得上去（服务端按题目 ID 挂附件）。
      if (remote && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          await uploadQuestionAttachment(file, saved.id);
        }
      }

      toast.ok(question ? "题目已更新" : "题目已新增");
      onSaved?.(saved);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const objective = type === "single" || type === "multi" || type === "judge";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={question ? `编辑题目 · ${question.id}` : "新建题目"}
      className="dlg-wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleSave()}>
            保存题目
          </Button>
        </>
      }
    >
      <Field
        label="题目编号"
        hint={
          remote
            ? "题号用于题库检索与组卷引用，同一题库内唯一。"
            : "编号用于题库检索与组卷引用，保存后不可修改。"
        }
        htmlFor="qe-id"
      >
        <TextInput
          id="qe-id"
          value={remote ? code : id}
          readOnly={!remote && Boolean(question)}
          placeholder="例如 q-m-09"
          onChange={(event) =>
            remote ? setCode(event.target.value) : setId(event.target.value)
          }
        />
      </Field>

      <div className="grid-3" style={{ marginTop: "var(--sp-4)" }}>
        <Field label="题型" htmlFor="qe-type">
          <SelectInput
            id="qe-type"
            value={type}
            onChange={(event) => handleTypeChange(event.target.value as QuestionType)}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="分值" htmlFor="qe-score">
          <TextInput
            id="qe-score"
            type="number"
            min={1}
            max={40}
            value={score}
            onChange={(event) => setScore(Number(event.target.value) || 0)}
          />
        </Field>
        <Field label="状态" hint="新建默认草稿，发布后可用于组卷。" htmlFor="qe-status">
          <SelectInput
            id="qe-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <div className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            标签
            <span className={`tag-counter${tags.length >= MAX_TAGS ? " is-full" : ""}`}>
              {tags.length}/{MAX_TAGS}
            </span>
          </span>
        </div>
        <TagPicker
          selected={tags}
          onToggle={toggleTag}
          {...(catalogTags ? { tags: catalogTags } : {})}
        />
        <div className="field-hint">
          标签决定题目在答题端的筛选与归类，最多 {MAX_TAGS} 个；难度由「难度」分组标签决定。
        </div>
      </div>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <Field label="题干" required htmlFor="qe-stem">
          <TextArea
            id="qe-stem"
            value={stem}
            placeholder="输入题干"
            onChange={(event) => setStem(event.target.value)}
          />
        </Field>
      </div>

      <div style={{ marginTop: "var(--sp-5)" }}>
        {objective ? (
          <>
            <h3 className="section-title">选项与答案</h3>
            <div className="card" style={{ marginTop: "var(--sp-3)" }}>
              <div className="card-body">
                {options.map((opt, index) => (
                  <div
                    className="opt-order"
                    key={opt.key}
                    style={{ gridTemplateColumns: "52px minmax(0,1fr) 92px" }}
                  >
                    <span className="oo-pos">{opt.key}</span>
                    <TextInput
                      value={opt.text}
                      placeholder="选项内容"
                      aria-label={`选项 ${opt.key}`}
                      onChange={(event) => {
                        const text = event.target.value;
                        setOptions((prev) =>
                          prev.map((o, i) => (i === index ? { ...o, text } : o)),
                        );
                      }}
                    />
                    <label className="checkline">
                      <input
                        type={type === "multi" ? "checkbox" : "radio"}
                        name="qe-answer"
                        checked={answer.includes(opt.key)}
                        onChange={() => toggleAnswer(opt.key)}
                      />
                      <span className="checkline-text">
                        <span className="checkline-hint">设为正确答案</span>
                      </span>
                    </label>
                  </div>
                ))}
                {options.length < 6 ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      const nextKey = String.fromCharCode(65 + options.length);
                      setOptions((prev) => [...prev, { key: nextKey, text: "" }]);
                    }}
                  >
                    增加选项
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
              判断题固定为「正确 / 错误」两项，且不参与梅花卷选项置换。
            </p>
          </>
        ) : type === "short" ? (
          <>
            <h3 className="section-title">评分要点</h3>
            <div className="card" style={{ marginTop: "var(--sp-3)" }}>
              <div className="card-body">
                {keypoints.map((kp, index) => (
                  <div
                    className="opt-order"
                    key={index}
                    style={{ gridTemplateColumns: "52px minmax(0,1fr) minmax(0,1fr)" }}
                  >
                    <span className="oo-pos">{index + 1}</span>
                    <TextInput
                      value={kp.text}
                      placeholder="评分要点"
                      aria-label={`评分要点 ${index + 1}`}
                      onChange={(event) => {
                        const text = event.target.value;
                        setKeypoints((prev) =>
                          prev.map((k, i) => (i === index ? { ...k, text } : k)),
                        );
                      }}
                    />
                    <TextInput
                      value={kp.keywords.join("，")}
                      placeholder="关键词，用逗号分隔"
                      aria-label={`评分要点 ${index + 1} 关键词`}
                      onChange={(event) => {
                        const keywords = event.target.value
                          .split(/[,，;；]/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setKeypoints((prev) =>
                          prev.map((k, i) => (i === index ? { ...k, keywords } : k)),
                        );
                      }}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  onClick={() =>
                    setKeypoints((prev) => [...prev, { text: "", keywords: [] }])
                  }
                >
                  增加要点
                </Button>
              </div>
            </div>
            <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
              系统按关键词自动初判，管理端复核后计入最终成绩；各要点平均分配分值。
            </p>
          </>
        ) : (
          <>
            <h3 className="section-title">评分步骤</h3>
            <div style={{ marginTop: "var(--sp-3)" }}>
              {steps.map((st, index) => (
                <div className="card" key={st.id} style={{ marginBottom: "var(--sp-3)" }}>
                  <div className="card-body">
                    <div className="grid-2">
                      <Field label="步骤提示" htmlFor={`step-prompt-${index}`}>
                        <TextInput
                          id={`step-prompt-${index}`}
                          value={st.prompt}
                          placeholder="例如 第一步：…"
                          onChange={(event) => {
                            const prompt = event.target.value;
                            setSteps((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, prompt } : s)),
                            );
                          }}
                        />
                      </Field>
                      <Field label="步骤分值" htmlFor={`step-score-${index}`}>
                        <TextInput
                          id={`step-score-${index}`}
                          type="number"
                          min={1}
                          max={40}
                          value={st.score}
                          onChange={(event) => {
                            const value = Number(event.target.value) || 0;
                            setSteps((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, score: value } : s)),
                            );
                          }}
                        />
                      </Field>
                    </div>
                    <div style={{ marginTop: "var(--sp-3)" }}>
                      <Field label="参考答案" htmlFor={`step-answer-${index}`}>
                        <TextArea
                          id={`step-answer-${index}`}
                          value={st.answer}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSteps((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, answer: value } : s)),
                            );
                          }}
                        />
                      </Field>
                    </div>
                    <div style={{ marginTop: "var(--sp-3)" }}>
                      <Field label="命中关键词" htmlFor={`step-kw-${index}`}>
                        <TextInput
                          id={`step-kw-${index}`}
                          value={st.keywords.join("，")}
                          placeholder="关键词，用逗号分隔"
                          onChange={(event) => {
                            const keywords = event.target.value
                              .split(/[,，;；]/)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            setSteps((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, keywords } : s)),
                            );
                          }}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() =>
                  setSteps((prev) => [
                    ...prev,
                    {
                      id: `s${prev.length + 1}`,
                      prompt: "",
                      answer: "",
                      keywords: [],
                      score: 5,
                    },
                  ])
                }
              >
                增加步骤
              </Button>
            </div>
            <p className="section-note">综合操作题按步骤给分，每一步独立判定。</p>
          </>
        )}
      </div>

      <div style={{ marginTop: "var(--sp-5)" }}>
        <Field
          label="题目附件"
          hint="支持 png / jpg / webp，单个文件 ≤ 10 MB。附件访问走短期签名 URL，题目删除时附件软删除。"
          htmlFor="qe-attachments"
        >
          <input
            id="qe-attachments"
            className="input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => void handleAttach(event.target.files)}
          />
        </Field>
        {attachmentError ? (
          <Callout tone="danger" title="附件未添加">
            {attachmentError}
          </Callout>
        ) : null}
        {attachments.length > 0 || pendingFiles.length > 0 ? (
          <ul className="list">
            {attachments.map((att) => (
              <li className="list-row" key={att.id}>
                {att.url ? (
                  <img
                    src={att.url}
                    alt={att.fileName}
                    width={64}
                    height={64}
                    style={{ objectFit: "cover", borderRadius: "var(--r-sm)" }}
                  />
                ) : null}
                <div className="list-main">
                  <div className="list-title">{att.fileName}</div>
                  <div className="list-sub">{formatFileSize(att.size)}</div>
                </div>
                {/* 真实后端还没有「删附件」的端点，已上传的附件这里不给移除。 */}
                {remote ? null : (
                  <IconButton
                    label={`移除附件 ${att.fileName}`}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                  >
                    ✕
                  </IconButton>
                )}
              </li>
            ))}
            {pendingFiles.map((file) => (
              <li className="list-row" key={`${file.name}-${file.size}`}>
                <div className="list-main">
                  <div className="list-title">{file.name}</div>
                  <div className="list-sub">{formatFileSize(file.size)} · 保存题目时上传</div>
                </div>
                <IconButton
                  label={`移除附件 ${file.name}`}
                  onClick={() =>
                    setPendingFiles((prev) => prev.filter((item) => item !== file))
                  }
                >
                  ✕
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid-2" style={{ marginTop: "var(--sp-5)" }}>
        <Field label="解析" htmlFor="qe-analysis">
          <TextArea
            id="qe-analysis"
            value={analysis}
            placeholder="讲评时展示的解析"
            onChange={(event) => setAnalysis(event.target.value)}
          />
        </Field>
        <Field label="参考答案" htmlFor="qe-reference">
          <TextArea
            id="qe-reference"
            value={reference}
            placeholder="阅卷时展示的参考答案"
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
