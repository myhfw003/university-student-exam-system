/* ==========================================================================
   端到端流程 ④：考试全流程（进入 → 作答 → 交卷 → 看结果）
   --------------------------------------------------------------------------
   对应 T-P9-01 的「考试全流程」。

   这一条跑在 mock 数据源上：它验的是**学生端的完整旅程**（进场、作答、
   交卷确认、交卷后的状态），后端那一侧的判定由真实后端的接口巡检覆盖
   （api-contract.api.spec.ts）。

   强制交卷由服务端裁决（切屏计数、心跳），所以「切屏 3 次 → 强制交卷」
   放在真实后端那组用例里；本文件验不依赖服务端裁决的部分。
   ========================================================================== */

import { expect, test } from "@playwright/test";

test("学生端：进入考试 → 作答 → 交卷 → 看到已交卷状态", async ({ page }) => {
  // 1. 进入考试（mock 模式下身份自动登录）。
  await page.goto("/exams/exam-net-mid");
  await expect(page.getByText("计算机网络期中考试").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "答题卡" })).toBeVisible();

  // 2. 作答第一题（单选：点选项的 label，选项的 input 是视觉隐藏的）。
  await page.locator(".q-opts label").first().click();

  // 3. 交卷：先点「交卷」，再在确认弹窗里确认。
  await page.getByRole("button", { name: "交卷" }).click();
  await expect(page.getByRole("heading", { name: "确认交卷" })).toBeVisible();
  await page.getByRole("button", { name: "确认交卷", exact: true }).click();

  // 4. 交卷成功 → 跳到成绩报告页。
  //    mock 模式下的报告内容取自预置的历史成绩（刚交的这���没有历史记录，
  //    报告会显示「暂未参加该考试」）；报告内容本身由前端单测覆盖，
  //    真实后端路径由接口巡检覆盖。
  await expect(page.getByText(/已交卷/)).toBeVisible();
  await expect(page).toHaveURL(/\/exams\/exam-net-mid\/report/);
  await expect(page.getByText("计算机网络期中考试").first()).toBeVisible();
});
