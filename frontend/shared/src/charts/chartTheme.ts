/* ==========================================================================
   知行测评 · 图表取色
   颜色全部来自 design/theme.css 的令牌（CSS 变量），不写死具体色值，
   深浅主题自动跟随。
   ========================================================================== */

/** 图表序列调色板（按序取用）。 */
export const CHART_COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warn)",
  "var(--color-danger)",
] as const;

/** 折线 / 柱形的强调色。 */
export const CHART_ACCENT = "var(--color-primary)";

/** 图表浅色填充。 */
export const CHART_FILL = "var(--color-primary-soft)";

/** 坐标轴与网格颜色。 */
export const CHART_GRID = "var(--color-border)";
export const CHART_AXIS = "var(--color-text-3)";

/** 取调色板中第 index 个颜色，超出则循环。 */
export function chartColor(index: number): string {
  const count = CHART_COLORS.length;
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) % count : 0;
  return CHART_COLORS[safe] ?? CHART_ACCENT;
}

/** 计算「好看的」坐标轴上限（与原型 niceMax 一致）。 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log(value) / Math.LN10);
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}
