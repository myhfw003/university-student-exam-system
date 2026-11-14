import type { ReactNode } from "react";
import { NUM_CLASS } from "../utils/format";

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** 单位，显示在数值之后。 */
  unit?: ReactNode;
  /** 补充说明。 */
  hint?: ReactNode;
  className?: string;
}

/**
 * 统计卡片。类名沿用原型 .stat / .stat-label / .stat-value / .stat-hint。
 */
export function Stat({ label, value, unit, hint, className }: StatProps) {
  const classes = ["stat", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {/* 原型 .stat 是 grid，子元素一律用 span。 */}
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${NUM_CLASS}`}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}
