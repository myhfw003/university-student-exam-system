/* ==========================================================================
   审计页时间范围的单元测试
   --------------------------------------------------------------------------
   页面上选的是**日历日**，后端收的是**时间点**。这一层负责翻译，
   翻译错了就会出现「选了 11 月 18 日，筛出来的却是 11 月 17 日的行」。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { calendarDayOf, dayEndIso, dayStartIso } from "../timeRange";

describe("审计页时间范围", () => {
  it("起始日期：本地那天的 00:00:00.000", () => {
    const iso = dayStartIso("2026-11-18");
    expect(iso).toBeDefined();
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("结束日期：本地那天的最后一毫秒（含当天）", () => {
    const iso = dayEndIso("2026-11-18");
    expect(iso).toBeDefined();
    const d = new Date(iso!);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("起始在结束之前（同一天也是）", () => {
    const start = new Date(dayStartIso("2026-11-18")!).getTime();
    const end = new Date(dayEndIso("2026-11-18")!).getTime();
    expect(start).toBeLessThan(end);
  });

  it("空日期或不成格式 → 不给时间点（表示不限）", () => {
    expect(dayStartIso("")).toBeUndefined();
    expect(dayEndIso("")).toBeUndefined();
    expect(dayStartIso("不是日期")).toBeUndefined();
    expect(dayEndIso("2026-13-40")).toBeUndefined();
  });

  it("日历日：两种模式的时间戳写法都能取到前 10 位", () => {
    // mock 模式：本地时间串。
    expect(calendarDayOf("2026-11-12 08:20")).toBe("2026-11-12");
    // HTTP 模式：服务端给的 ISO 串。
    expect(calendarDayOf("2026-11-18T08:06:17Z")).toBe("2026-11-18");
    // 认不出来的就当没有日期。
    expect(calendarDayOf("")).toBe("");
    expect(calendarDayOf("未知")).toBe("");
  });
});
