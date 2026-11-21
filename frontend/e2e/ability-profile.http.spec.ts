/* ==========================================================================
   能力画像（浏览器连真实后端）
   --------------------------------------------------------------------------
   这一组跑的是**连后端模式的生产产物**（`pnpm build:http`）：

     浏览器 → 静态服务器（/api/ 反代）→ 真实后端

   验的是**页面呈现的是服务端给的数**，不是前端自己算的：

   1. 页面上出现的是后端给的能力标签名（mock 模式里那几个示例标签不该出现）；
   2. 掌握度百分数与样本量，与接口返回的**同一个值**（不写死数字）；
   3. 样本不足的项标「样本不足」，并单独计数。

   **为什么必须在真实后端上验**：mock 模式的数据是本地示例，
   掌握度、样本量、分档全在前端那一侧——页面照样能渲染，
   但「前端没有自己重算」这件事在 mock 模式下根本验不出来。

   **前提**：环境里要同时起 Worker。画像是定分驱动的，
   交卷后要等 Worker 把领域事件派发出去，画像才写得上。
   ========================================================================== */

import { expect, test, type Page } from "@playwright/test";
import { MASTERY_LABEL } from "../shared/src/domain/ability";
import { formatPercentWithSign } from "../shared/src/utils/format";
import {
  createAbilityTrack,
  prepareAbilityFixture,
  takeAndSubmit,
  waitForAbilityProfile,
} from "./setup/ability";

/** 在学生端浏览器里登录。 */
async function loginStudent(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#login-account", username);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  // 登录成功后落在工作台，标题是问候语 + **服务端给的**用户名：
  // 用它确认登录的是这个学生（而不是演示身份）。
  await expect(
    page.getByRole("heading", { name: /能力画像端到端学生/ }),
  ).toBeVisible();
}

test.describe("能力画像（浏览器连真实后端）", () => {
  // 交卷之后要等 Worker 把领域事件派发出去（它每 5 秒轮询一次 Outbox），
  // 默认的 60 秒用例超时留得不够宽。
  test.setTimeout(180_000);

  test("页面显示的是服务端给的掌握度、样本量与分档", async ({ browser }) => {
    const fixture = await prepareAbilityFixture();
    const track = await createAbilityTrack(fixture, 0);

    await takeAndSubmit(fixture.student, track.sessionId, track.questionId, true);

    // 先用接口确认服务端真的写上了画像，再去看页面：
    // 页面上的数要和接口返回的**同一个值**，不是各自算一遍。
    const profile = await waitForAbilityProfile(
      fixture.student,
      (p) => p.total >= 1,
      "交卷之后画像里应当出现这一项能力",
    );
    const item = profile.items[0]!;
    const expectedPercent = formatPercentWithSign(item.masteryRate * 100);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginStudent(page, fixture.studentCredentials.username, fixture.studentCredentials.password);

    await page.goto("/profile/abilities");
    await expect(page.getByRole("heading", { name: "能力画像" })).toBeVisible();

    // 1. 页面上是后端给的那个能力标签名。
    await expect(page.getByText(track.tagName).first()).toBeVisible();

    // 2. 掌握度百分数与接口返回的同一个值。
    await expect(page.getByText(expectedPercent).first()).toBeVisible();

    // 3. 样本量：一次作答就是一个样本。
    await expect(page.getByText("样本 1").first()).toBeVisible();

    // 4. 样本不足的项标「样本不足」，并单独计数。
    //    徽标用 .badge 定位：统计卡的标签也叫「样本不足」，别认错。
    await expect(
      page.locator(".badge", { hasText: MASTERY_LABEL.insufficient }).first(),
    ).toBeVisible();
    const insufficientStat = page.locator(".stat", { hasText: "样本不足" });
    await expect(insufficientStat.locator(".stat-value")).toContainText("1");

    // 5. mock 模式里的示例能力标签不该出现——那说明页面读的是 mock 而不是后端。
    await expect(page.getByText("计算求解")).toHaveCount(0);

    await context.close();
  });
});
