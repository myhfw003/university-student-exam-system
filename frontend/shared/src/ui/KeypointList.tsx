/* ==========================================================================
   知行测评 · 评分要点 / 步骤列表
   --------------------------------------------------------------------------
   原型结构：.kp-list > .kp（is-hit）+ .kp-mark + 文本 + 得分。
   ========================================================================== */

import type { CSSProperties } from "react";
import type { KeypointGrade, StepGrade } from "../engine/scoring";
import { formatScore } from "../utils/format";

/** 要点项。 */
export interface KeypointItem {
  /** 要点文本（简答）或步骤题干（综合题）。 */
  text: string;
  /** 是否命中。 */
  hit: boolean;
  /** 得分；不填就不显示分值那一列（判分依据只给命中与否）。 */
  score?: number;
  /** 满分；不填就不显示分值那一列。 */
  max?: number;
}

/** 要点列表属性。 */
export interface KeypointListProps {
  items: readonly KeypointItem[];
  /** 行内样式——原型给 .kp-list 加了 margin-top:var(--sp-2)。 */
  style?: CSSProperties;
}

/** 要点 / 步骤列表。 */
export function KeypointList({ items, style }: KeypointListProps) {
  return (
    <div className="kp-list" style={style}>
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={`kp${item.hit ? " is-hit" : ""}`}>
          {/* 原型 .kp-mark 不隐藏：命中与否是评分要点的一部分，AT 要能读到。 */}
          <span className="kp-mark">{item.hit ? "✓" : "○"}</span>
          <span>{item.text}</span>
          {item.max === undefined ? null : (
            <span className="num text-3">
              {formatScore(item.score ?? 0)}/{formatScore(item.max)}
            </span>
          )}
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
