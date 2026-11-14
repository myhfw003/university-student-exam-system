/* ==========================================================================
   端到端流程 ③：考试中切屏被检测与反馈
   --------------------------------------------------------------------------
   §12 的原流程是「切屏 3 次 → 被强制交卷」。其中**强制交卷由服务端裁决**
   （docs/design/06-frontend.md §6.2：客户端只上报不判定），后端的心跳与
   切屏计数接口未就绪，这一段用 test.skip 标注。

   本文件验证不依赖后端的部分：切屏被采集、给出分级反馈（横幅）、
   同一时间窗内的重复事件被去重。
   ========================================================================== */

import { expect, test } from "@playwright/test";

test("考试答题：切屏被采集并给出反馈", async ({ page }) => {
  await page.goto("/exams/exam-net-mid");
  await expect(page.getByText("计算机网络期中考试").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "答题卡" })).toBeVisible();

  // 第一次切屏：普通提示横幅。
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await expect(page.getByText(/检测到切屏（第 1\/\d+ 次）/)).toBeVisible();

  // 500ms 窗口内的同类事件应被去重，计数不跳。
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(200);
  await expect(page.getByText(/检测到切屏（第 1\/\d+ 次）/)).toBeVisible();

  // 第二次切屏（超过去重窗口）：横幅升级为警告色。
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await expect(page.getByText(/检测到切屏（第 2\/\d+ 次）/)).toBeVisible();
});

test.skip("端到端：切屏 3 次后被服务端强制交卷", async () => {
  // 后端就绪后打开：切屏计数与强制交卷由服务端裁决（§6.2）。
});
