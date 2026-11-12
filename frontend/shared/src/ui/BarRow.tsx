/* ==========================================================================
   知行测评 · 横向条
   --------------------------------------------------------------------------
   原型结构：.bar-row > 名称 + .bar-track > .bar-fill + 右侧数值。
   用于题型得分、错题分布等。
   ========================================================================== */

/** 横条属性。 */
export interface BarRowProps {
  /** 名称。 */
  label: string;
  /** 附加说明（如分组名）。 */
  hint?: string;
  /** 当前值。 */
  value: number;
  /** 上限。 */
  max: number;
  /** 右侧数值文本。 */
  trailing?: string;
  /** 色调。 */
  tone?: "default" | "warn" | "danger";
  /** 名称截断宽度。 */
  truncate?: boolean;
}

/** 横向条。 */
export function BarRow({ label, hint, value, max, trailing, tone = "default", truncate }: BarRowProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fillClass = tone === "default" ? "" : ` is-${tone}`;

  return (
    <div className="bar-row">
      <span className={truncate ? "od-truncate" : undefined}>
        {label}
        {hint ? <span className="text-3 text-xs"> · {hint}</span> : null}
      </span>
      <span className="bar-track">
        <span className={`bar-fill${fillClass}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="right num text-sm">{trailing ?? value}</span>
    </div>
  );
}
