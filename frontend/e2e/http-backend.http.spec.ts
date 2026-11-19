/* ==========================================================================
   浏览器连真实后端（联调 UI 用例）
   --------------------------------------------------------------------------
   这一组跑的是**连后端模式的生产产物**（`pnpm build:http`）：

     浏览器 → 静态服务器（/api/ 反代）→ 真实后端

   与 mock 模式那组用例的区别：这里断言的是**真实后端给的数据**——
   登录、鉴权、DTO 映射、页面渲染都要对得上。

   断言方式统一为「页面上出现的正是接口返回的那一条」：
   先用接口取到一条真实数据，再在页面上找它——不写死具体数值，
   后端数据变了用例也不会假失败。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import {
  adminPassword,
  adminUsername,
  apiRoot,
  ensureStudent,
  login,
} from "./setup/api";

/** 读接口，给断言提供「后端给的那一条」。 */
async function fetchJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`读取 ${path} 失败：HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

test.describe("浏览器连真实后端", () => {
  test("管理端：登录后看到后端给的那一场考试", async ({ page }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const list = await fetchJson<{ items?: Array<{ name?: string }> }>(
      "/api/v1/exam-sessions?page=1&size=1",
      admin.token,
    );
    const name = list.items?.[0]?.name;
    expect(name, "后端应当至少有一场考试").toBeTruthy();

    await page.goto("/admin/login");
    await page.fill("#login-account", adminUsername);
    await page.fill("#login-password", adminPassword);
    await page.click('button[type="submit"]');

    // 登录后落在概览页——鉴权与跳转都真的走通了。
    await expect(page).toHaveURL(/\/admin\/overview/);
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();

    await page.goto("/admin/exam-sessions");
    // 列表里出现的是后端给的那一场考试（不是示例数据）。
    await expect(page.getByText(name!, { exact: false }).first()).toBeVisible();
  });

  test("学生端：登录后工作台显示后端给的推荐练习", async ({ page }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    const summary = await fetchJson<{ recommendedPractices?: Array<{ title?: string }> }>(
      "/api/v1/dashboard/summary",
      student.token,
    );
    const title = summary.recommendedPractices?.[0]?.title;
    expect(title, "后端应当给出至少一条推荐练习").toBeTruthy();

    await page.goto("/login");
    await page.fill("#login-account", account.username);
    await page.fill("#login-password", account.password);
    await page.click('button[type="submit"]');

    await expect(page.getByText("推荐练习")).toBeVisible();
    await expect(page.getByText(title!, { exact: false }).first()).toBeVisible();
  });
});
