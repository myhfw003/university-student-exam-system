import { describe, expect, it } from "vitest";
import {
  NUM_CLASS,
  formatClock,
  formatDate,
  formatDateTime,
  formatInteger,
  formatMinutes,
  formatPercent,
  formatPercentWithSign,
  formatScore,
  formatTime,
} from "../format";

describe("formatScore", () => {
  it("整数原样输出", () => {
    expect(formatScore(100)).toBe("100");
    expect(formatScore(0)).toBe("0");
    expect(formatScore(-5)).toBe("-5");
  });

  it("最多保留 1 位小数", () => {
    expect(formatScore(86.5)).toBe("86.5");
    expect(formatScore(86.44)).toBe("86.4");
    expect(formatScore(86.46)).toBe("86.5");
  });

  it("非法输入返回占位符", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
  });
});

describe("formatClock", () => {
  it("不足 1 小时用 MM:SS", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(599)).toBe("09:59");
  });

  it("超过 1 小时用 HH:MM:SS", () => {
    expect(formatClock(3600)).toBe("01:00:00");
    expect(formatClock(3661)).toBe("01:01:01");
  });

  it("负数按 0 处理", () => {
    expect(formatClock(-10)).toBe("00:00");
  });
});

describe("formatPercent", () => {
  it("整数原样，非整数最多 1 位小数", () => {
    expect(formatPercent(80)).toBe("80");
    expect(formatPercent(79.94)).toBe("79.9");
    expect(formatPercent(79.96)).toBe("80");
  });

  it("带符号版本追加百分号", () => {
    expect(formatPercentWithSign(80)).toBe("80%");
    expect(formatPercentWithSign(79.94)).toBe("79.9%");
  });
});

describe("日期格式化", () => {
  const date = new Date(2026, 10, 9, 8, 5, 0);

  it("formatDateTime 输出 YYYY-MM-DD HH:mm", () => {
    expect(formatDateTime(date)).toBe("2026-11-09 08:05");
  });

  it("formatTime 输出 HH:mm", () => {
    expect(formatTime(date)).toBe("08:05");
  });

  it("formatDate 输出 YYYY-MM-DD", () => {
    expect(formatDate(date)).toBe("2026-11-09");
  });

  it("空值与非法值返回占位符", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("其他", () => {
  it("formatMinutes 输出中文时长", () => {
    expect(formatMinutes(45)).toBe("45 分钟");
    expect(formatMinutes(90)).toBe("1 小时 30 分钟");
  });

  it("formatInteger 使用千分位", () => {
    expect(formatInteger(3846)).toBe("3,846");
  });

  it("NUM_CLASS 为等宽数字类名", () => {
    expect(NUM_CLASS).toBe("num");
  });
});
