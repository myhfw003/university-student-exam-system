import { chartColor, CHART_FILL, niceMax } from "./chartTheme";

export interface HorizontalBarChartDatum {
  label: string;
  value: number;
  /** 是否使用强调色。 */
  accent?: boolean;
}

export interface HorizontalBarChartProps {
  data: ReadonlyArray<HorizontalBarChartDatum>;
  title?: string;
  /** 数值后缀，例如「分」。 */
  valueSuffix?: string;
  className?: string;
}

const W = 640;
const ROW_H = 34;
const PAD_L = 132;
const PAD_R = 56;
const PAD_T = 12;

/**
 * 横向条形图（自研 SVG）。适合知识点掌握度、难度分布等长标签场景。
 */
export function HorizontalBarChart({
  data,
  title = "排行图",
  valueSuffix = "",
  className,
}: HorizontalBarChartProps) {
  const H = PAD_T * 2 + Math.max(data.length, 1) * ROW_H;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const trackW = W - PAD_L - PAD_R;

  return (
    <svg
      className={className ? `chart ${className}` : "chart"}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      {data.map((d, i) => {
        const y = PAD_T + i * ROW_H;
        const width = (d.value / max) * trackW;
        const color = d.accent === true ? chartColor(0) : CHART_FILL;
        return (
          <g key={d.label}>
            <text className="chart-axis" x={PAD_L - 10} y={y + ROW_H / 2 + 4} textAnchor="end">
              {d.label}
            </text>
            <rect
              x={PAD_L}
              y={y + ROW_H / 2 - 6}
              width={trackW}
              height={12}
              rx="3"
              style={{ fill: "var(--color-surface-3)" }}
            />
            <rect
              x={PAD_L}
              y={y + ROW_H / 2 - 6}
              width={Math.max(width, 0)}
              height={12}
              rx="3"
              style={{ fill: color, stroke: d.accent === true ? color : chartColor(0) }}
            />
            <text className="chart-value" x={W - PAD_R + 8} y={y + ROW_H / 2 + 4}>
              {d.value}
              {valueSuffix}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
