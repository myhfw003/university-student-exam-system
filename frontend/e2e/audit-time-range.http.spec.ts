/* ==========================================================================
   审计页时间范围筛选（真实后端）
   --------------------------------------------------------------------------
   对应 FR-IAM-07 的验收：支持按操作者、动作、时间范围、对象过滤。
   前四种里时间范围原先只有后端与 API 层支持，页面上没有控件。

   **为什么必须在真实后端上验**：时间范围是**服务端**过滤的
   （`from` / `to` 交给 `GET /audit-logs`），mock 模式走的是前端过滤，
   验不出参数有没有真的被服务端认下。

   **时区**：页面上的日期按**本地日历日**选（`timeRange.ts` 把那天翻成
   本地零点到本地最后一毫秒），而服务端返回的是 UTC 时间戳。
   两者对不齐，所以断言不能拿 UTC 日期去比——要比的是「这一行是不是落在
   选中的那个本地日之内」。
   ========================================================================== */

import { expect, test, type Page } from "@playwright/test";
import { adminPassword, adminUsername } from "./setup/api";

/** 在管理端浏览器里登录。 */
async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.fill("#login-account", adminUsername);
  await page.fill("#login-password", adminPassword);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
}

/** 本地日历日（「YYYY-MM-DD」）。 */
function localToday(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 本地那天的起止时间点。 */
function localDayBounds(day: string): { start: number; end: number } {
  const [year, month, date] = day.split("-").map(Number);
  return {
    start: new Date(year!, month! - 1, date!, 0, 0, 0, 0).getTime(),
    end: new Date(year!, month! - 1, date!, 23, 59, 59, 999).getTime(),
  };
}

test.describe("审计页时间范围筛选（真实后端）", () => {
  test("选一段时间：只留下这段时间的行", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAdmin(page);

    await page.goto("/admin/audit-logs");
    await expect(page.getByRole("heading", { name: "审计", exact: true })).toBeVisible();

    // 挑一个一定没有数据的时间段：1999 年。
    await page.fill("#audit-from", "1999-01-01");
    await page.fill("#audit-to", "1999-12-31");
    await expect(page.getByText("没有符合条件的日志")).toBeVisible();

    // 换成今天：应该有数据（刚登录就写了一条登录审计）。
    const today = localToday();
    await page.fill("#audit-from", today);
    await page.fill("#audit-to", today);

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();

    // 每行的时间都要落在选中的那个本地日之内。
    const bounds = localDayBounds(today);
    const times = await rows.locator("td:first-child").allInnerTexts();
    expect(times.length).toBeGreaterThan(0);
    for (const value of times) {
      const at = new Date(value.trim()).getTime();
      expect(Number.isNaN(at)).toBe(false);
      expect(at).toBeGreaterThanOrEqual(bounds.start);
      expect(at).toBeLessThanOrEqual(bounds.end);
    }

    await context.close();
  });
});
