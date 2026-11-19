/* ==========================================================================
   端到端流程 ②（可离线验证的部分）：管理端内容生产与组卷
   --------------------------------------------------------------------------
   §12 的完整流程是「组卷 → 发布 → 阅卷 → 发布成绩 → 学生看到成绩」，
   其中「发布成绩」与「学生看到成绩」依赖后端（成绩发布的接口尚未就绪），
   这部分用 test.skip 标注，等后端就绪后打开。

   本文件验证不依赖后端的环节：内容工作台、标签筛选、组卷向导四步、
   发布校验清单、阅卷队列。
   ========================================================================== */

import { expect, test } from "@playwright/test";

test("管理端：内容工作台与标签筛选", async ({ page }) => {
  await page.goto("/admin/overview");
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
  await expect(page.getByText("待办工作台")).toBeVisible();

  await page.goto("/admin/banks");
  await expect(page.getByRole("heading", { name: "题库", exact: true })).toBeVisible();

  // 进入工作台：三 Tab + 标签筛选。
  await page.getByRole("button", { name: "工作台" }).first().click();
  await expect(page.getByRole("tab", { name: /题目/ })).toBeVisible();
  await expect(page.getByText("标签筛选")).toBeVisible();
});

test("管理端：组卷向导四步与发布校验", async ({ page }) => {
  await page.goto("/admin/papers/exam-net-mid");
  await expect(page.getByRole("heading", { name: "计算机网络期中考试" })).toBeVisible();

  // 四步步骤条：每一步一个可点的卡片。
  const steps = page.locator(".steps .step-btn");
  await expect(steps).toHaveCount(4);

  // 走到「名单与发布」这一步，看发布校验清单。
  await steps.nth(3).click();
  await expect(page.getByText(/发布校验|校验未通过|校验通过/).first()).toBeVisible();
});

test("管理端：阅卷队列可打开卷宗", async ({ page }) => {
  await page.goto("/admin/review");
  await expect(page.getByRole("heading", { name: "阅卷中心" })).toBeVisible();
  await expect(page.getByText("卷宗队列")).toBeVisible();
  await expect(page.getByText("答题者作答")).toBeVisible();
});

test.skip("端到端：组卷发布 → 阅卷 → 发布成绩 → 学生看到成绩", async () => {
  // 这条流程在**真实后端**上验，见同目录的 `review-grade-publish.http.spec.ts`
  // （跑连后端模式的生产产物）：组卷与建场次走接口，
  // 浏览器里跑「学生作答 → 教师阅卷打分 → 发布成绩 → 学生看到分数」。
});
