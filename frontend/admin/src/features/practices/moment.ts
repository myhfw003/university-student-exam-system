/* ==========================================================================
   知行测评 · 练习开放单的时间
   --------------------------------------------------------------------------
   开放期在两种模式下写法不同：
   - HTTP 模式是服务端给的 ISO 串（UTC）；
   - mock 模式是本地时间串（「2026-11-15 08:00」）。

   页面上一律按**浏览器本地时区**显示与编辑，
   所以这里负责把两种写法翻成本地时间，
   以及把输入框里的本地时间翻回 ISO 交给后端。
   ========================================================================== */

/** 两位补零。 */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 时间串 → Date；认不出来就当没有。 */
function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 时间串 → 「YYYY-MM-DDTHH:mm」（`datetime-local` 输入框的值）。 */
export function toLocalInput(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 「YYYY-MM-DDTHH:mm」→ ISO 串（按本地时区解释这个时刻）；空表示不限。 */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** 时间串 → 「YYYY-MM-DD HH:mm」（列表显示）；空表示不限。 */
export function formatMoment(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "不限";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
