/* ==========================================================================
   审计页的时间范围
   --------------------------------------------------------------------------
   页面上选的是**日历日**（起始日期 / 结束日期），后端收的是**时间点**
   （`from` / `to`，DateTimeOffset）。这里把日历日翻成时间点，两边对齐。

   日界按**浏览器本地时区**算：管理员选「11 月 18 日」，指的就是他当地
   那一整天。转成时间点时带上时区偏移，后端拿到的是同一个瞬间。
   ========================================================================== */

/** 「YYYY-MM-DD」。 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 把「YYYY-MM-DD」翻成本地那天的某个时刻。
 *
 * **不存在的日期要拒绝掉**：JavaScript 的 Date 会把越界的值顺延
 * （`new Date(2026, 12, 40)` 变成 2027 年 2 月 9 日），
 * 那会让「选了 13 月 40 日」悄悄筛出别的一天。翻好之后对一下年月日，
 * 对不上就说明这个日期不存在，返回空。
 */
function localDateOf(day: string, endOfDay: boolean): Date | undefined {
  const match = DAY.exec(day);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const d = endOfDay
    ? new Date(year, month - 1, date, 23, 59, 59, 999)
    : new Date(year, month - 1, date, 0, 0, 0, 0);
  // 顺延过就说明日期不存在。
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== date) {
    return undefined;
  }
  return d;
}

/** 把「YYYY-MM-DD」翻成本地那天的起始时间点（ISO）。 */
export function dayStartIso(day: string): string | undefined {
  return localDateOf(day, false)?.toISOString();
}

/** 把「YYYY-MM-DD」翻成本地那天的结束时间点（ISO，含当天最后一毫秒）。 */
export function dayEndIso(day: string): string | undefined {
  return localDateOf(day, true)?.toISOString();
}

/**
 * 行上的时间戳 → 日历日（「YYYY-MM-DD」）。
 *
 * 两种模式下时间戳的写法不一样（mock 是 `2026-11-12 08:20`，
 * HTTP 是服务端给的 ISO 串），但日历日都在最前面，取前 10 个字符即可。
 */
export function calendarDayOf(at: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(at);
  return match?.[1] ?? "";
}
