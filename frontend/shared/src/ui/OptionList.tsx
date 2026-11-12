/* ==========================================================================
   知行测评 · 客观题选项
   --------------------------------------------------------------------------
   原型结构：.q-opts > label.opt > input(视觉隐藏) + .opt-key + .opt-text

   关键语义：
   - 卷面上显示的字母按**位置**重新编号（A/B/C/D…），不是原题字母；
   - `displayKeys` 是按显示顺序排列的**原题选项键**；
   - `toOriginal` 记录「显示字母 → 原题键」，判分时用它还原。
   ========================================================================== */

import type { QuestionOption } from "../domain/types";

/** 选项列表属性。 */
export interface OptionListProps {
  /** 原题选项（键为原题字母）。 */
  options: readonly QuestionOption[];
  /** 按显示顺序排列的原题选项键；缺省视为不置换。 */
  displayKeys?: readonly string[];
  /** 显示字母 → 原题键。 */
  toOriginal?: Readonly<Record<string, string>>;
  /** 考生所选的显示字母。 */
  selected?: readonly string[];
  /** 选择变化回调（传入新的显示字母数组）。 */
  onChange?: (next: string[]) => void;
  /** 是否多选。 */
  multiple?: boolean;
  /** 只读模式（回看 / 阅卷）。 */
  readOnly?: boolean;
  /** 正确答案（原题键），提供时高亮。 */
  correct?: readonly string[];
}

/** 显示字母表。 */
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** 客观题选项列表。 */
export function OptionList({
  options,
  displayKeys,
  toOriginal,
  selected = [],
  onChange,
  multiple = false,
  readOnly = false,
  correct,
}: OptionListProps) {
  // 显示顺序：置换后按 displayKeys 排列原题选项，否则原序。
  const ordered = displayKeys
    ? displayKeys
        .map((key) => options.find((o) => o.key === key))
        .filter((o): o is QuestionOption => Boolean(o))
    : [...options];

  const selectedSet = new Set(selected);

  const toggle = (displayLetter: string) => {
    if (readOnly || !onChange) return;
    if (multiple) {
      const next = selectedSet.has(displayLetter)
        ? selected.filter((s) => s !== displayLetter)
        : [...selected, displayLetter].sort();
      onChange(next);
    } else {
      onChange([displayLetter]);
    }
  };

  return (
    <div className="q-opts" role={multiple ? "group" : "radiogroup"}>
      {ordered.map((option, position) => {
        const displayLetter = LETTERS[position] ?? String(position + 1);
        const isSelected = selectedSet.has(displayLetter);
        const originalKey = toOriginal?.[displayLetter] ?? option.key;
        const isCorrect = correct ? correct.includes(originalKey) : false;
        const isWrong = Boolean(correct) && isSelected && !isCorrect;

        const classes = [
          "opt",
          isSelected ? "is-selected" : "",
          isCorrect ? "is-correct" : "",
          isWrong ? "is-wrong" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <label key={originalKey} className={classes}>
            <input
              type={multiple ? "checkbox" : "radio"}
              name={`opt-${originalKey}`}
              checked={isSelected}
              disabled={readOnly}
              onChange={() => toggle(displayLetter)}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
            <span className="opt-key" aria-hidden="true">
              {displayLetter}
            </span>
            <span className="opt-text">{option.text}</span>
          </label>
        );
      })}
    </div>
  );
}
