/* ==========================================================================
   知行测评 · 格式化工具
   与原型 shared/js/app.js 中的 EX.fmt 对齐（分数 / 时钟 / 百分比 / 日期）。
   所有数值输出都应配合 NUM_CLASS（tabular-nums）使用，避免数字跳动。
   ========================================================================== */

/** 数字排版类名：等宽数字，避免列表 / 表格中数字宽度抖动。 */
export const NUM_CLASS = "num";

/** 分数格式化：整数原样，最多保留 1 位小数。 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 百分比格式化：整数原样，最多保留 1 位小数（不带 % 号）。 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 百分比（带 % 号）。 */
export function formatPercentWithSign(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${formatPercent(n)}%`;
}

/**
 * 时钟格式化：不足 1 小时用 MM:SS，超过 1 小时用 HH:MM:SS。
 */
export function formatClock(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const n = Number(totalSeconds);
  if (!Number.isFinite(n)) return "—";
  const s = Math.max(0, Math.floor(n));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (v: number) => (v < 10 ? `0${v}` : String(v));
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/** 时长（分钟）→ 中文文案。 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const n = Number(minutes);
  if (!Number.isFinite(n)) return "—";
  const m = Math.max(0, Math.floor(n));
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分钟` : `${m} 分钟`;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(v: number): string {
  return v < 10 ? `0${v}` : String(v);
}

/** 日期时间：YYYY-MM-DD HH:mm。 */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** 时间：HH:mm。 */
export function formatTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 日期：YYYY-MM-DD。 */
export function formatDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 千分位整数。 */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("zh-CN");
}
