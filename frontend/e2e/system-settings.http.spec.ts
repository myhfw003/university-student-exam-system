/* ==========================================================================
   系统设置页（真实后端）
   --------------------------------------------------------------------------
   浏览器 → 连后端模式的产物 → 真实后端。

   **为什么必须在真实后端上验**：设置是**全局**的，mock 模式里改的是
   内存里的一份 store，页面当然「改了就生效」——那证明不了任何事。
   这里验的是：页面上显示的**就是后端存的值**，保存真的写进了后端，
   刷新之后还在。

   用例跑完把设置还原成缺省档，别把后面的用例带歪。
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

/**
 * 把设置切到指定的那一档并保存。
 *
 * 已经是那一档就什么都不做——保存按钮在「没改动」时是禁用的，
 * 无脑点会一直等到超时。
 */
async function ensurePolicy(page: Page, target: "移出错题本" | "保留但标记已掌握") {
  const button = page.getByRole("button", { name: target });

  if ((await button.getAttribute("aria-pressed")) === "true") return;

  await button.click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("系统设置已保存，立即生效")).toBeVisible();
}

test.describe("系统设置页（真实后端）", () => {
  test("改完刷新还在（跑完还原）", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAdmin(page);

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();

    // 两档都在页面上。
    await expect(page.getByRole("button", { name: "移出错题本" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保留但标记已掌握" })).toBeVisible();

    // 换成「保留但标记已掌握」并保存。
    await ensurePolicy(page, "保留但标记已掌握");

    // 说明跟着切换到这一档。
    await expect(
      page.getByText("重做正确的题目留在错题本里，标成「已掌握」，在「含已掌握」筛选下能看到。"),
    ).toBeVisible();

    // 刷新：值还在——说明真的写进了后端，不是页面自己记着的。
    await page.reload();
    await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保留但标记已掌握" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 还原：别把库留在改过的状态。
    await ensurePolicy(page, "移出错题本");

    await page.reload();
    await expect(page.getByRole("button", { name: "移出错题本" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await context.close();
  });

  test("原始密码：配好后显示已配置，刷新还在（跑完清除）", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAdmin(page);

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();

    // 没配时显示「未配置」。
    await expect(page.getByText("未配置")).toBeVisible();

    await page.fill("#original-password", "OrigPass123");
    await page.getByRole("button", { name: "设置原始密码" }).click();
    await expect(page.getByText("原始密码已设置。重置用户密码时会置成它。")).toBeVisible();

    // 刷新：状态还在——说明真的写进了后端，不是页面自己记着的。
    await page.reload();
    await expect(page.getByText("已配置")).toBeVisible();

    // 还原：清除原始密码。
    await page.getByRole("button", { name: "清除原始密码" }).click();
    await expect(page.getByText("原始密码已清除，此后重置密码会被拒绝")).toBeVisible();

    await page.reload();
    await expect(page.getByText("未配置")).toBeVisible();

    await context.close();
  });
});
