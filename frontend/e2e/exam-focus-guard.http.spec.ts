/* ==========================================================================
   端到端流程 ③：考试中切屏 3 次 → 被服务端强制交卷（真实后端）
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §12 的流程 ③。

   这一条只在**真实后端**上成立：**强制交卷由服务端裁决**
   （§6.2：客户端只上报不判定）。服务端按场次规则累计切屏次数，
   达到上限后按 `onMaxFocusLoss` 处置——这里用的是 `force_submit`。

   跑的是连后端模式的生产产物（`pnpm build:http`）：
   浏览器 → 静态服务器（/api/ 反代）→ 真实后端。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import {
  adminPassword,
  adminUsername,
  apiRoot,
  ensureStudent,
  login,
  type Session,
} from "./setup/api";

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

/**
 * 准备一场可考的考试：建题 → 组卷 → 发布 → 建场次（指定考生）→ 发布场次。
 *
 * 场次规则里 `maxFocusLoss: 3` + `onMaxFocusLoss: force_submit`：
 * 切屏 3 次即被强制交卷。
 */
async function prepareSession(
  admin: Session,
  student: Session,
): Promise<{ sessionId: number }> {
  const tags = await api(admin, "GET", "/api/v1/tags");
  const allTags: { id: number; code: string }[] = (tags.json?.groups ?? []).flatMap(
    (group: any) => group.tags ?? [],
  );
  const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
  expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

  const question = await api(admin, "POST", "/api/v1/questions", {
    code: `e2e-focus-${Date.now()}`,
    type: "single",
    stem: "端到端题目：1 + 1 = ?",
    defaultScore: 10,
    difficultyTagId: difficulty!.id,
    options: [
      { key: "A", text: "2", isCorrect: true },
      { key: "B", text: "3", isCorrect: false },
    ],
    analysis: "端到端用例的解析。",
  });
  expect(question.status, "建题").toBeLessThan(300);
  const questionId = question.json.question.id;

  await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});

  const paper = await api(admin, "POST", "/api/v1/papers", {
    kind: "exam",
    name: `端到端切屏试卷-${Date.now()}`,
    targetTotalScore: 10,
    durationMinutes: 30,
    passScore: 6,
    orderRule: "by_type",
    variantRule: "standard",
    answerPolicy: "immediately",
  });
  expect(paper.status, "建卷").toBeLessThan(300);
  const paperId = paper.json.paper.id;

  await api(admin, "POST", `/api/v1/papers/${paperId}/items`, {
    questionId,
    score: 10,
    sortOrder: 1,
  });

  const published = await api(admin, "POST", `/api/v1/papers/${paperId}/publish`, {
    warningOverrideReason: "端到端用例：只放一道题用于验证切屏强制交卷。",
  });
  expect(published.status, "发布试卷").toBeLessThan(300);

  const now = new Date();
  const session = await api(admin, "POST", "/api/v1/exam-sessions", {
    paperId,
    name: `端到端切屏场次-${Date.now()}`,
    openAt: new Date(now.getTime() - 60_000).toISOString(),
    closeAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    durationMinutes: 30,
    participantMode: "direct",
    participantUserIds: [student.userId],
    variantRule: "standard",
    rules: {
      maxFocusLoss: 3,
      onMaxFocusLoss: "force_submit",
      requireFullScreen: false,
      blockCopyPaste: false,
      blockContextMenu: false,
      showWatermark: true,
      enableHeartbeatCheck: true,
      heartbeatIntervalSeconds: 15,
      heartbeatTimeoutSeconds: 45,
      maxDisconnect: 10,
      earlyEntryMinutes: 0,
    },
  });
  expect(session.status, "建场次").toBeLessThan(300);
  const sessionId = session.json.session.id;

  const publishSession = await api(admin, "POST", `/api/v1/exam-sessions/${sessionId}/publish`, {});
  expect(publishSession.status, "发布场次").toBeLessThan(300);

  return { sessionId };
}

test.describe("考试中切屏被服务端强制交卷（真实后端）", () => {
  test("切屏 3 次后服务端强制交卷，页面显示已交卷", async ({ page }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    const { sessionId } = await prepareSession(admin, student);

    // 1. 学生登录（连后端模式：真的走 /auth/login）。
    await page.goto("/login");
    await page.fill("#login-account", account.username);
    await page.fill("#login-password", account.password);
    await page.click('button[type="submit"]');
    await expect(page.getByText("推荐练习").first()).toBeVisible();

    // 2. 进入这场考试。
    await page.goto(`/exams/${sessionId}`);
    await expect(page.getByRole("heading", { name: "答题卡" })).toBeVisible();

    // 3. 切屏 3 次。
    //    客户端 500ms 窗口内去重，所以两次之间要等过去（§6.1）。
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
      });
      await page.waitForTimeout(700);
    }

    // 4. 服务端裁决：页面进入「已交卷」阻断态。
    await expect(page.getByText("本场考试已交卷")).toBeVisible();

    // 5. 再从服务端确认一次：确实是服务端强制交卷，不是前端自己判的。
    const attempts = await api(student, "GET", "/api/v1/attempts?page=1&size=50");
    const mine = (attempts.json?.items ?? []).filter(
      (row: any) => Number(row.examSessionId) === Number(sessionId),
    );
    expect(mine.length, "这场考试应当有一次作答").toBeGreaterThan(0);
    expect(
      ["submitted", "force_submitted", "auto_submitted"],
      `切屏 3 次后会话状态应为已交卷，实际是 ${mine[0]?.status}`,
    ).toContain(mine[0]?.status);
  });
});
