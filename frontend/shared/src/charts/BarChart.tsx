import { chartColor, CHART_FILL, niceMax } from "./chartTheme";

export interface BarChartDatum {
  label: string;
  value: number;
  /** 是否使用强调色。 */
  accent?: boolean;
}

export interface BarChartProps {
  data: ReadonlyArray<BarChartDatum>;
  title?: string;
  className?: string;
}

const W = 640;
const H = 220;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 18;
const PAD_B = 36;

/**
 * 纵向柱状图（自研 SVG）。
 */
export function BarChart({ data, title = "分布图", className }: BarChartProps) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.min(46, slot * 0.62);

  const grid = Array.from({ length: 5 }, (_, g) => {
    const gy = PAD_T + (innerH / 4) * g;
    const gv = Math.round(max - (max / 4) * g);
    return (
      <g key={g}>
        <line className="chart-grid" x1={PAD_L} y1={gy} x2={W - PAD_R} y2={gy} />
        <text className="chart-axis" x={PAD_L - 8} y={gy + 4} textAnchor="end">
          {gv}
        </text>
      </g>
    );
  });

  return (
    <svg
      className={className ? `chart ${className}` : "chart"}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      {grid}
      {data.map((d, i) => {
        const height = (d.value / max) * innerH;
        const x = PAD_L + slot * i + (slot - barW) / 2;
        const y = PAD_T + innerH - height;
        const color = d.accent === true ? chartColor(0) : CHART_FILL;
        return (
          <g key={d.label}>
            <rect
              className={d.accent === true ? "chart-bar is-accent" : "chart-bar"}
              x={x}
              y={y}
              width={barW}
              height={Math.max(height, 0)}
              rx="2"
              style={{ fill: color, stroke: d.accent === true ? color : chartColor(0) }}
            />
            <text className="chart-value" x={x + barW / 2} y={y - 6} textAnchor="middle">
              {d.value}
            </text>
            <text className="chart-axis" x={x + barW / 2} y={H - 14} textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
