/* ==========================================================================
   知行测评 · 答题卡
   --------------------------------------------------------------------------
   原型结构：.answer-sheet > button.sheet-cell（is-answered / is-current）
   + .sheet-flag（已标记圆点）；下方 .sheet-legend 图例。
   ========================================================================== */

import type { ReactNode } from "react";

/** 答题卡格子。 */
export interface SheetCell {
  /** 卷面题号（1 起）。 */
  slot: number;
  /** 题目 ID。 */
  qid: string;
  /** 是否已作答。 */
  answered: boolean;
  /** 是否已标记。 */
  marked?: boolean;
}

/** 答题卡属性。 */
export interface AnswerSheetProps {
  cells: readonly SheetCell[];
  /** 当前题号。 */
  currentSlot: number;
  /** 点击格子。 */
  onSelect: (cell: SheetCell) => void;
  /** 图例（可自定义）。 */
  legend?: ReactNode;
}

/** 答题卡。 */
export function AnswerSheet({ cells, currentSlot, onSelect, legend }: AnswerSheetProps) {
  return (
    <div>
      <div className="answer-sheet">
        {cells.map((cell) => {
          const classes = [
            "sheet-cell",
            cell.answered ? "is-answered" : "",
            cell.slot === currentSlot ? "is-current" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const label = [
            `第 ${cell.slot} 题`,
            cell.answered ? "已作答" : "未作答",
            cell.marked ? "已标记" : "",
          ]
            .filter(Boolean)
            .join("，");

          return (
            <button
              key={cell.qid}
              type="button"
              className={classes}
              aria-label={label}
              aria-current={cell.slot === currentSlot ? "true" : undefined}
              onClick={() => onSelect(cell)}
            >
              {cell.slot}
              {cell.marked ? <span className="sheet-flag" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {legend ?? (
        <div className="sheet-legend">
          <span>
            <span className="legend-dot is-answered" />已作答
          </span>
          <span>
            <span className="legend-dot" />未作答
          </span>
          <span>
            <span className="legend-dot is-current" />当前题
          </span>
          <span>
            <span className="legend-dot is-flag" />已标记
          </span>
        </div>
      )}
    </div>
  );
}
