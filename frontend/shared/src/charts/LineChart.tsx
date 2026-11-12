import { chartColor, CHART_FILL, niceMax } from "./chartTheme";

export interface LineChartDatum {
  label: string;
  value: number;
}

export interface LineChartProps {
  data: ReadonlyArray<LineChartDatum>;
  /** 图表标题，同时作为 aria-label。 */
  title?: string;
  /** 是否在点上方标注数值。 */
  showValues?: boolean;
  /** 多系列时按系列索引取色。 */
  seriesIndex?: number;
  className?: string;
}

const W = 640;
const H = 220;
const PAD_L = 40;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 34;

/**
 * 折线图（自研 SVG，不引入 ECharts / Recharts）。
 */
export function LineChart({
  data,
  title = "趋势图",
  showValues = true,
  seriesIndex = 0,
  className,
}: LineChartProps) {
  const color = chartColor(seriesIndex);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: PAD_L + (data.length > 1 ? stepX * i : innerW / 2),
    y: PAD_T + innerH - (d.value / max) * innerH,
    d,
  }));

  const path = points
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area =
    first && last
      ? `${path} L${last.x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} L${first.x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} Z`
      : "";

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
      {area ? <path className="chart-area" d={area} style={{ fill: CHART_FILL }} /> : null}
      {points.length > 0 ? (
        <path className="chart-line" d={path} style={{ stroke: color }} />
      ) : null}
      {points.map((p) => (
        <circle
          key={p.d.label}
          className="chart-dot"
          cx={p.x}
          cy={p.y}
          r={4}
          style={{ stroke: color }}
        />
      ))}
      {showValues
        ? points.map((p) => (
            <text
              key={`v-${p.d.label}`}
              className="chart-value"
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
            >
              {p.d.value}
            </text>
          ))
        : null}
      {points.map((p) => (
        <text
          key={`l-${p.d.label}`}
          className="chart-axis"
          x={data.length > 1 ? p.x : W / 2}
          y={H - 12}
          textAnchor="middle"
        >
          {p.d.label}
        </text>
      ))}
    </svg>
  );
}
