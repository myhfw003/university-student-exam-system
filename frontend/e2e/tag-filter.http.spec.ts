/* ==========================================================================
   题库工作台的标签筛选（真实后端）
   --------------------------------------------------------------------------
   对应 FR-CAT-02：按标签筛选题目时支持「包含子标签」（默认开启），
   多个标签之间默认「任一命中」，可切「全部命中」。

   **为什么必须在真实后端上验**：这条链路上一版整条是坏的——前端把标签 ID
   拼成逗号串（`tagIds=8,9`），服务端的 `long[]` 只认重复参数，整条请求 400。
   mock 模式验不出来：mock 没有绑定，也没有父子标签。

   造数据的部分走接口（建一对父子标签 + 两道题），浏览器留给
   「只有页面才能验」的那一段：chip 选中 → 请求怎么发 → 列表怎么变。
   ========================================================================== */

import { expect, test, type Page } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login, type Session } from "./setup/api";

/** 一次请求：带上令牌，返回状态与解析后的 JSON。 */
async function api(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

/** 造一对父子标签与两道题：父标签挂一道、子标签挂一道。 */
async function prepareTagFixture(
  session: Session,
  suffix: string,
): Promise<{ parentName: string; childName: string; parentId: number; childId: number; parentQuestionCode: string; childQuestionCode: string }> {
  const parentName = `筛选父标签-${suffix}`;
  const childName = `筛选子标签-${suffix}`;

  // 难度标签：按 code 找，别写死 id。
  const tags = await api(session, "GET", "/api/v1/tags");
  const allTags: { id: number; code: string }[] = (tags.json?.groups ?? []).flatMap(
    (group: any) => group.tags ?? [],
  );
  const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
  expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();
  const difficultyId = difficulty!.id;

  const parent = await api(session, "POST", "/api/v1/tags", {
    code: `e2e.filter.parent.${suffix}`,
    name: parentName,
    group: "domain",
  });
  expect(parent.status, `建父标签：${JSON.stringify(parent.json)}`).toBeLessThan(300);
  const parentId = parent.json.id as number;

  const child = await api(session, "POST", "/api/v1/tags", {
    code: `e2e.filter.child.${suffix}`,
    name: childName,
    group: "domain",
    parentId,
  });
  expect(child.status, `建子标签：${JSON.stringify(child.json)}`).toBeLessThan(300);
  const childId = child.json.id as number;

  // 一道挂父标签，一道挂子标签。
  const parentQuestionCode = `E2E-FILTER-P-${suffix}`;
  const childQuestionCode = `E2E-FILTER-C-${suffix}`;

  const parentQuestion = await api(session, "POST", "/api/v1/questions", {
    code: parentQuestionCode,
    type: "single",
    stem: `筛选验证题（父标签）${suffix}`,
    defaultScore: 5,
    tagIds: [parentId],
    difficultyTagId: difficultyId,
    options: [
      { key: "A", text: "正确", isCorrect: true },
      { key: "B", text: "错误", isCorrect: false },
    ],
    analysis: "筛选验证用。",
  });
  expect(parentQuestion.status, `建父标签题目：${JSON.stringify(parentQuestion.json)}`).toBeLessThan(300);

  const childQuestion = await api(session, "POST", "/api/v1/questions", {
    code: childQuestionCode,
    type: "single",
    stem: `筛选验证题（子标签）${suffix}`,
    defaultScore: 5,
    tagIds: [childId],
    difficultyTagId: difficultyId,
    options: [
      { key: "A", text: "正确", isCorrect: true },
      { key: "B", text: "错误", isCorrect: false },
    ],
    analysis: "筛选验证用。",
  });
  expect(childQuestion.status, `建子标签题目：${JSON.stringify(childQuestion.json)}`).toBeLessThan(300);

  // 发布：工作台的题目列表默认只看「已发布」。
  for (const questionId of [parentQuestion.json.question.id, childQuestion.json.question.id]) {
    const published = await api(session, "POST", `/api/v1/questions/${questionId}/publish`, {});
    expect(published.status, `发布题目：${JSON.stringify(published.json)}`).toBeLessThan(300);
  }

  return { parentName, childName, parentId, childId, parentQuestionCode, childQuestionCode };
}

/** 在管理端浏览器里登录。 */
async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.fill("#login-account", adminUsername);
  await page.fill("#login-password", adminPassword);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
}

test.describe("标签筛选语义（真实后端）", () => {
  test("含子标签时父标签命中子标签的题目；关掉后不再命中", async ({ browser }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const suffix = String(Date.now()).slice(-9);
    const fixture = await prepareTagFixture(admin, suffix);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAdmin(page);

    // 抓真实发出的题目列表请求：断言标签 ID 走的是重复参数。
    const questionUrls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/v1/questions?")) questionUrls.push(req.url());
    });

    await page.goto("/admin/banks/__all__?tab=questions");
    await expect(page.getByRole("heading", { name: "全部题库" })).toBeVisible();

    // 选中父标签。
    await page.getByRole("button", { name: fixture.parentName }).click();

    // 父标签命中子标签的题目（包含子标签默认开启）。
    await expect(page.getByText(`筛选验证题（子标签）${suffix}`)).toBeVisible();
    await expect(page.getByText(`筛选验证题（父标签）${suffix}`)).toBeVisible();

    // 请求必须是重复参数，不能是逗号串（逗号串会被服务端判成非法值）。
    const tagged = questionUrls.filter((url) => url.includes("tagIds="));
    expect(tagged.length, "选中标签后应发出带 tagIds 的请求").toBeGreaterThan(0);
    for (const url of tagged) {
      const params = new URL(url).searchParams;
      const values = params.getAll("tagIds");
      expect(values.length, `tagIds 应是重复参数：${url}`).toBeGreaterThan(0);
      // 逗号串会被服务端的 long[] 判成非法值（整条请求 400）。
      for (const value of values) {
        expect(value, `标签 ID 不能拼成逗号串：${url}`).not.toContain(",");
        expect(value, `标签 ID 应是数字：${url}`).toMatch(/^\d+$/);
      }
    }

    // 关掉「包含子标签」：只认标签本身，子标签的题目不再出现。
    await page.getByRole("checkbox", { name: "包含子标签" }).click();
    await expect(page.getByText(`筛选验证题（子标签）${suffix}`)).toHaveCount(0);
    await expect(page.getByText(`筛选验证题（父标签）${suffix}`)).toBeVisible();

    // 打开「包含子标签」再选上子标签：两个标签都命中。
    await page.getByRole("checkbox", { name: "包含子标签" }).click();
    await page.getByRole("button", { name: fixture.childName }).click();
    await expect(page.getByText(`筛选验证题（子标签）${suffix}`)).toBeVisible();
    await expect(page.getByText(`筛选验证题（父标签）${suffix}`)).toBeVisible();

    // 切到「全部命中」：父标签与子标签都要命中——
    // 挂父标签的题目不含子标签，按命中该标签的任意后代才算命中它，
    // 所以它不再命中；挂子标签的题目两个标签都算命中。
    await page.getByRole("button", { name: "全部命中" }).click();
    await expect(page.getByText(`筛选验证题（子标签）${suffix}`)).toBeVisible();
    await expect(page.getByText(`筛选验证题（父标签）${suffix}`)).toHaveCount(0);

    await context.close();
  });
});
