/* ==========================================================================
   端到端流程 ①：登录 → 进入练习 → 作答 → 提交 → 看解析
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §12 的第一条流程。
   ========================================================================== */

import { expect, test } from "@playwright/test";

test("学生端：练习作答到提交后看解析", async ({ page }) => {
  // 1. 进入工作台（mock 模式下演示身份自动登录，守卫照常生效）。
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /林知远/ }).first()).toBeVisible();
  await expect(page.getByText("进行中的考试").first()).toBeVisible();

  // 2. 练习中心 → 开始练习。
  await page.goto("/practice");
  await expect(page.getByRole("heading", { name: "练习中心" })).toBeVisible();
  await page.getByRole("button", { name: "开始练习" }).first().click();

  // 3. 作答第一题（单选：勾选一个选项）。
  await expect(page.getByRole("radiogroup").first()).toBeVisible();
  // 选项的 input 是视觉隐藏的（原型样式），因此点 label 而不是勾 input。
  await page.locator(".q-opts label").first().click();

  // 4. 提交练习（练习不计时、不走交卷二次确认）。
  await page.getByRole("button", { name: "提交练习" }).click();

  // 5. 看结果：得分与逐题解析。
  await expect(page.getByText("本次得分")).toBeVisible();
  await expect(page.getByText("逐题解析")).toBeVisible();
});
