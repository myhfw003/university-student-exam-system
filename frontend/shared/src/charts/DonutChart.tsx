import { chartColor } from "./chartTheme";

export interface DonutChartDatum {
  label: string;
  value: number;
}

export interface DonutChartProps {
  data: ReadonlyArray<DonutChartDatum>;
  title?: string;
  /** 圆心显示的文本。 */
  centerLabel?: string;
  /** 圆心显示的数值。 */
  centerValue?: string;
  className?: string;
}

const SIZE = 240;
const CENTER = SIZE / 2;
const R_OUTER = 96;
const R_INNER = 60;

/**
 * 环形图（自研 SVG）。用 stroke-dasharray 切分圆环。
 */
export function DonutChart({
  data,
  title = "占比图",
  centerLabel,
  centerValue,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const circumference = 2 * Math.PI * R_OUTER;

  let offset = 0;
  const segments = data.map((d, i) => {
    const ratio = total > 0 ? Math.max(0, d.value) / total : 0;
    const length = ratio * circumference;
    const segment = { d, i, ratio, length, offset };
    offset += length;
    return segment;
  });

  return (
    <svg
      className={className ? `chart ${className}` : "chart"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R_OUTER}
          fill="none"
          strokeWidth={R_OUTER - R_INNER}
          style={{ stroke: "var(--color-surface-3)" }}
        />
        {segments.map((s) => (
          <circle
            key={s.d.label}
            cx={CENTER}
            cy={CENTER}
            r={R_OUTER}
            fill="none"
            strokeWidth={R_OUTER - R_INNER}
            strokeDasharray={`${s.length} ${circumference - s.length}`}
            strokeDashoffset={-s.offset}
            style={{ stroke: chartColor(s.i) }}
          />
        ))}
      </g>
      {centerValue !== undefined ? (
        <text
          className="chart-value"
          x={CENTER}
          y={CENTER + 2}
          textAnchor="middle"
          style={{ fontSize: 20 }}
        >
          {centerValue}
        </text>
      ) : null}
      {centerLabel !== undefined ? (
        <text className="chart-axis" x={CENTER} y={CENTER + 20} textAnchor="middle">
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}
