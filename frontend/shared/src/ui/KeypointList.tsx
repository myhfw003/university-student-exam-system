/* ==========================================================================
   知行测评 · 评分要点 / 步骤列表
   --------------------------------------------------------------------------
   原型结构：.kp-list > .kp（is-hit）+ .kp-mark + 文本 + 得分。
   ========================================================================== */

import type { KeypointGrade, StepGrade } from "../engine/scoring";

/** 要点项。 */
export interface KeypointItem {
  /** 要点文本（简答）或步骤题干（综合题）。 */
  text: string;
  /** 是否命中。 */
  hit: boolean;
  /** 得分。 */
  score: number;
  /** 满分。 */
  max: number;
}

/** 要点列表属性。 */
export interface KeypointListProps {
  items: readonly KeypointItem[];
}

/** 要点 / 步骤列表。 */
export function KeypointList({ items }: KeypointListProps) {
  return (
    <div className="kp-list">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={`kp${item.hit ? " is-hit" : ""}`}>
          <span className="kp-mark" aria-hidden="true">
            {item.hit ? "✓" : "○"}
          </span>
          <span>{item.text}</span>
          <span className="num text-3">
            {item.score}/{item.max}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 把简答要点判分明细转成列表项。 */
export function keypointItems(points: readonly KeypointGrade[]): KeypointItem[] {
  return points.map((p) => ({ text: p.text, hit: p.hit, score: p.score, max: p.max }));
}

/** 把综合题步骤判分明细转成列表项。 */
export function stepItems(steps: readonly StepGrade[]): KeypointItem[] {
  return steps.map((s) => ({ text: s.prompt, hit: s.hit, score: s.score, max: s.max }));
}
