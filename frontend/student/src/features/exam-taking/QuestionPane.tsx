/* ==========================================================================
   知行测评 · 题干与作答区
   --------------------------------------------------------------------------
   一道题的完整呈现：题头（题号 / 题型 / 分值 / 难度 / 标签 / 选项已置换）
   + 题干 + 按题型切换的作答区。

   作答区与题型对应：
   - 单选 / 判断 → 选项列表（单选）
   - 多选 → 选项列表（多选）
   - 简答 → 多行文本
   - 综合操作题 → 每个步骤一个多行文本
   ========================================================================== */

import { QuestionHead, OptionList } from "@exam/shared";
import type { Question } from "@exam/shared/domain/types";
import type { BuiltPaperItem } from "@exam/shared/engine/paper";
import { useQuestionTags } from "./questionMeta";

/** 作答内容。choice 存**卷面显示字母**。 */
export interface AnswerResponse {
  choice?: string[];
  text?: string;
  steps?: Record<string, string>;
}

/** 题干与作答区属性。 */
export interface QuestionPaneProps {
  /** 卷面题位。 */
  item: BuiltPaperItem;
  /** 题目。 */
  question: Question;
  /** 当前作答（未作答时为 undefined）。 */
  response: AnswerResponse | undefined;
  /** 选项变化。 */
  onChoiceChange?: (keys: string[]) => void;
  /** 简答文本变化。 */
  onTextChange?: (text: string) => void;
  /** 综合题步骤文本变化。 */
  onStepChange?: (stepId: string, text: string) => void;
  /** 只读（回看 / 提交后）。 */
  readOnly?: boolean;
  /** 回看时展示正确答案。 */
  correct?: readonly string[];
}

export function QuestionPane({
  item,
  question,
  response,
  onChoiceChange,
  onTextChange,
  onStepChange,
  readOnly = false,
  correct,
}: QuestionPaneProps) {
  const { tags, difficulty } = useQuestionTags(question.tags);
  const isObjective = question.type !== "short" && question.type !== "comprehensive";

  return (
    <>
      <QuestionHead
        slot={item.slot}
        type={question.type}
        score={item.score}
        {...(difficulty ? { difficultyName: difficulty.name } : {})}
        tags={tags}
        permuted={item.changed}
      />

      <div className="q-stem">{question.stem}</div>

      {isObjective ? (
        <OptionList
          options={question.options ?? []}
          displayKeys={item.displayKeys}
          toOriginal={item.toOriginal}
          selected={response?.choice ?? []}
          {...(onChoiceChange ? { onChange: onChoiceChange } : {})}
          multiple={question.type === "multi"}
          readOnly={readOnly}
          {...(correct ? { correct } : {})}
        />
      ) : null}

      {question.type === "short" ? (
        <div className="field">
          <label className="field-label" htmlFor={`ans-${question.id}`}>
            作答内容
            <span className="field-req" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={`ans-${question.id}`}
            className="textarea"
            value={response?.text ?? ""}
            disabled={readOnly}
            placeholder="按要点分条作答，每行一条要点"
            onChange={(event) => onTextChange?.(event.target.value)}
          />
          <span className="field-hint">
            要点式作答更容易得分，系统会按关键词自动初判，阅卷人随后复核。
          </span>
        </div>
      ) : null}

      {question.type === "comprehensive"
        ? (question.steps ?? []).map((step) => (
            <div className="field" key={step.id} style={{ marginBottom: "var(--sp-4)" }}>
              <label className="field-label" htmlFor={`ans-${question.id}-${step.id}`}>
                {step.prompt} <span className="field-hint">（{step.score} 分）</span>
              </label>
              <textarea
                id={`ans-${question.id}-${step.id}`}
                className="textarea"
                style={{ minHeight: 110 }}
                value={response?.steps?.[step.id] ?? ""}
                disabled={readOnly}
                placeholder="在此作答"
                onChange={(event) => onStepChange?.(step.id, event.target.value)}
              />
            </div>
          ))
        : null}
    </>
  );
}
