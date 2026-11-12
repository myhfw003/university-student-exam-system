/* ==========================================================================
   知行测评 · 管理端题目编辑器
   --------------------------------------------------------------------------
   原型 admin.js 的 openQuestionEditor + questionEditorHtml + dynamicEditorHtml。

   题型决定下半区的结构：
     单选 / 多选 / 判断 → 选项与答案（判断题固定两项且不参与置换）
     简答             → 评分要点（系统按关键词初判，各要点均分）
     综合操作         → 评分步骤（每步独立判定，按权重等比缩放）
   ========================================================================== */

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Field,
  SelectInput,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import { upsertQuestion } from "@exam/shared/mock/catalog";
import type {
  Question,
  QuestionKeypoint,
  QuestionOption,
  QuestionStep,
  QuestionType,
} from "@exam/shared/domain/types";
import { MAX_TAGS } from "@exam/shared/mock/catalog";
import { TagPicker } from "./TagPicker";

const TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
  { value: "single", label: "单选题" },
  { value: "multi", label: "多选题" },
  { value: "judge", label: "判断题" },
  { value: "short", label: "简答题" },
  { value: "comprehensive", label: "综合操作题" },
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
}

/** 题目编辑器对话框。 */
export function QuestionEditor({ open, question, onClose, onSaved }: QuestionEditorProps) {
  const [id, setId] = useState("");
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

  // 打开时载入题目（新建时用空表单）。
  useEffect(() => {
    if (!open) return;
    if (question) {
      setId(question.id);
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
    } else {
      setId("");
      setType("single");
      setScore(5);
      setStatus("draft");
      setTags([]);
      setStem("");
      setAnalysis("");
      setReference("");
      setOptions([
        { key: "A", text: "" },
        { key: "B", text: "" },
        { key: "C", text: "" },
        { key: "D", text: "" },
      ]);
      setAnswer([]);
      setKeypoints([
        { text: "", keywords: [] },
        { text: "", keywords: [] },
        { text: "", keywords: [] },
      ]);
      setSteps([
        { id: "s1", prompt: "", answer: "", keywords: [], score: 5 },
        { id: "s2", prompt: "", answer: "", keywords: [], score: 5 },
      ]);
    }
  }, [open, question]);

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

  const handleSave = () => {
    const result = upsertQuestion({
      ...(id.trim() ? { id: id.trim() } : {}),
      type,
      score,
      status: status as Question["status"],
      source: question?.source ?? "manual",
      tags,
      stem,
      analysis,
      ...(reference.trim() ? { reference } : {}),
      answer,
      ...(type === "single" || type === "multi" || type === "judge"
        ? { options }
        : type === "short"
          ? { keypoints }
          : { steps }),
      ...(question?.batchId ? { batchId: question.batchId } : {}),
    });

    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok("题目已保存");
    onSaved?.(result.question!);
    onClose();
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
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <Field label="题目编号" hint="编号用于题库检索与组卷引用，保存后不可修改。" htmlFor="qe-id">
        <TextInput
          id="qe-id"
          value={id}
          readOnly={Boolean(question)}
          placeholder="例如 q-m-09"
          onChange={(event) => setId(event.target.value)}
        />
      </Field>

      <div className="grid-3" style={{ marginTop: "var(--sp-4)" }}>
        <Field label="题型" htmlFor="qe-type">
          <SelectInput
            id="qe-type"
            value={type}
            onChange={(event) => setType(event.target.value as QuestionType)}
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
        <TagPicker selected={tags} onToggle={toggleTag} />
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
                          .split(/[,，]/)
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
                              .split(/[,，]/)
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
