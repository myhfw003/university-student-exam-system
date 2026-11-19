/* ==========================================================================
   登录审计（真实后端）
   --------------------------------------------------------------------------
   对应 FR-AUD-01：登录成功与登录失败都要留下审计行。

   **为什么必须在真实后端上验**：审计行是后端写的。
   mock 模式由前端自己补一行，验不出后端漏写。

   失败那一次用临时账号试：管理员账号连着登错会被锁
   （FR-IAM-01 的五次锁定），反复跑用例会把管理员锁在外面。
   ========================================================================== */

import { expect, test, type Page } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login, type Session } from "./setup/api";

/** 在管理端浏览器里登录。 */
async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.fill("#login-account", adminUsername);
  await page.fill("#login-password", adminPassword);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
}

/** 造一个临时账号，用它来试失败的登录。 */
async function createTempUser(admin: Session, suffix: string): Promise<string> {
  const username = `e2e-login-${suffix}`;
  const response = await fetch(`${apiRoot}/api/v1/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.token}`,
    },
    body: JSON.stringify({
      username,
      displayName: "登录审计临时用户",
      password: "TempPass123",
    }),
  });
  expect(response.status, `建临时账号：${await response.text()}`).toBeLessThan(300);
  return username;
}

test.describe("登录审计（真实后端）", () => {
  test("登录成功与登录失败都出现在审计页上", async ({ browser }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const suffix = String(Date.now()).slice(-9);
    const tempUser = await createTempUser(admin, suffix);

    // 一次失败的登录：密码打错。
    const failed = await fetch(`${apiRoot}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: tempUser, password: "definitely-wrong" }),
    });
    expect(failed.status).toBe(422);

    // 一次成功的登录：走浏览器。
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAdmin(page);

    await page.goto("/admin/audit-logs");
    await expect(page.getByRole("heading", { name: "审计", exact: true })).toBeVisible();

    // 登录成功：动作交给服务端筛，筛完只剩登录成功的行。
    await page.getByRole("button", { name: "登录成功" }).click();
    await expect(page.getByRole("cell", { name: adminUsername }).first()).toBeVisible();

    // 登录失败：失败那次的操作者是临时账号。
    await page.getByRole("button", { name: "登录失败" }).click();
    await expect(page.getByRole("cell", { name: tempUser }).first()).toBeVisible();

    await context.close();
  });
});
