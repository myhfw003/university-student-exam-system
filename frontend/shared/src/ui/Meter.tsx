/** 进度条色调，与原型 .meter.is-ok / .is-warn / .is-danger 对应。 */
export type MeterTone = "primary" | "ok" | "warn" | "danger";

export interface MeterProps {
  /** 当前值。 */
  value: number;
  /** 上限，缺省 100。 */
  max?: number;
  tone?: MeterTone;
  /** 无障碍名称。 */
  label?: string;
  className?: string;
}

/**
 * 进度条。类名沿用原型 .meter。
 */
export function Meter({ value, max = 100, tone = "primary", label, className }: MeterProps) {
  const safeMax = max === 0 ? 100 : max;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);
  const toneClass = tone === "primary" ? null : `is-${tone}`;
  const classes = ["meter", toneClass, className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
