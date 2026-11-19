/* ==========================================================================
   端到端流程 ②：阅卷 → 发布成绩 → 学生看到成绩（真实后端）
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §12 的流程 ②
   （教师组卷 → 阅卷 → 发布成绩 → 学生看到成绩）。

   **组卷与建场次走接口**（与 api 组的生命周期用例同一套准备），
   浏览器里跑的是这条流程里**只有页面才能验**的那一段：

     学生作答交卷 → 教师在阅卷中心领取并打分 → 场次详情发布成绩
       → 学生在自己的成绩列表里看到分数

   学生端与��理端是两个 SPA、同源——**刷新令牌是 HttpOnly Cookie**，
   两边共用一个浏览器上下文会互相顶掉会话，所以用两个独立的上下文。
   ========================================================================== */

import { expect, test, type BrowserContext } from "@playwright/test";
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
 * 组一套「一道主观题」的考试：建题 → 发布 → 组卷 → 发布 → 建场次 → 发布场次。
 *
 * 组卷与建场次走接口：这部分在 api 组已有覆盖，这里用接口准备，
 * 把浏览器留给「只有页面才能验」的环节。
 */
async function prepareSubjectiveExam(
  admin: Session,
  student: Session,
): Promise<{ sessionId: number; examName: string }> {
  const tags = await api(admin, "GET", "/api/v1/tags");
  const allTags: { id: number; code: string }[] = (tags.json?.groups ?? []).flatMap(
    (group: any) => group.tags ?? [],
  );
  const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
  expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

  const question = await api(admin, "POST", "/api/v1/questions", {
    code: `e2e-review-${Date.now()}`,
    type: "short",
    stem: "简述 TCP 的三次握手过程，并说明为什么需要三次而不是两次。",
    defaultScore: 10,
    difficultyTagId: difficulty!.id,
    referenceAnswer: "客户端 SYN → 服务端 SYN+ACK → 客户端 ACK。",
    analysis: "要点：SYN、SYN+ACK、ACK 三步。",
    keypoints: [
      { text: "客户端发送 SYN", keywords: ["SYN"] },
      { text: "服务端回复 SYN+ACK", keywords: ["SYN+ACK"] },
      { text: "客户端发送 ACK 完成连接", keywords: ["ACK"] },
    ],
  });
  expect(question.status, "建题").toBeLessThan(300);
  const questionId = question.json.question.id;
  await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});

  const examName = `端到端阅卷场次-${Date.now()}`;
  const paper = await api(admin, "POST", "/api/v1/papers", {
    kind: "exam",
    name: `端到端阅卷试卷-${Date.now()}`,
    targetTotalScore: 10,
    durationMinutes: 30,
    passScore: 6,
    orderRule: "by_type",
    variantRule: "standard",
    answerPolicy: "immediately",
  });
  const paperId = paper.json.paper.id;
  await api(admin, "POST", `/api/v1/papers/${paperId}/items`, {
    questionId,
    score: 10,
    sortOrder: 1,
  });
  const published = await api(admin, "POST", `/api/v1/papers/${paperId}/publish`, {
    warningOverrideReason: "端到端用例：只放一道主观题用于验证阅卷与发布成绩。",
  });
  expect(published.status, "发布试卷").toBeLessThan(300);

  const now = new Date();
  const session = await api(admin, "POST", "/api/v1/exam-sessions", {
    paperId,
    name: examName,
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

  return { sessionId, examName };
}

/** 在浏览器里登录。 */
async function loginInBrowser(
  context: BrowserContext,
  basePath: string,
  account: string,
  password: string,
) {
  const page = await context.newPage();
  await page.goto(`${basePath}/login`);
  await page.fill("#login-account", account);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  return page;
}

test.describe("阅卷 → 发布成绩 → 学生看到成绩（真实后端）", () => {
  test("教师阅卷打分并发布成绩后，学生看得到分数", async ({ browser }) => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    const { sessionId, examName } = await prepareSubjectiveExam(admin, student);

    // 学生端与管理端各用一个上下文：刷新令牌是 HttpOnly Cookie，共用会互相顶掉。
    const studentContext = await browser.newContext();
    const adminContext = await browser.newContext();

    /* ---------------------------------------------------- 学生作答交卷 */

    const studentPage = await loginInBrowser(
      studentContext,
      "",
      account.username,
      account.password,
    );
    await expect(studentPage.getByText("推荐练习").first()).toBeVisible();

    await studentPage.goto(`/exams/${sessionId}`);
    await expect(studentPage.getByRole("heading", { name: "答题卡" })).toBeVisible();

    // 主观题：按要点作答（命中关键词，阅卷时有初判建议可复核）。
    await studentPage
      .getByPlaceholder("按要点分条作答，每行一条要点")
      .fill("客户端发送 SYN\n服务端回复 SYN+ACK\n客户端发送 ACK 完成连接");

    await studentPage.getByRole("button", { name: "交卷" }).click();
    await expect(studentPage.getByRole("heading", { name: "确认交卷" })).toBeVisible();
    await studentPage.getByRole("button", { name: "确认交卷", exact: true }).click();

    // 交卷后跳到成绩报告：主观题还在待阅，分数没定。
    await expect(studentPage).toHaveURL(new RegExp(`/exams/${sessionId}/report`));
    await expect(studentPage.getByText("待阅").first()).toBeVisible();

    /* ---------------------------------------------------- 教师领取并打分 */

    const adminPage = await loginInBrowser(
      adminContext,
      "/admin",
      adminUsername,
      adminPassword,
    );
    await expect(adminPage.getByRole("heading", { name: "概览" })).toBeVisible();

    await adminPage.goto("/admin/review");
    await expect(adminPage.getByText("卷宗队列")).toBeVisible();

    // 队列里点开**这场考试**的卷宗。
    // 按考试名定位而不是按学生名：同一个学生在队列里可能还有别的待阅卷宗，
    // 点错一份就会把分打到别的卷上。
    const queueRow = adminPage.locator(".list-row", { hasText: examName });
    await queueRow.first().click();
    await expect(adminPage.getByText("答题者作答")).toBeVisible();
    await expect(adminPage.getByText(examName).first()).toBeVisible();

    // 领取：先到先得，别的教师就抢不走了。
    await adminPage.getByRole("button", { name: "领取任务" }).click();

    // 打分：点分数档位，再保存评分。
    await adminPage.getByRole("button", { name: "8", exact: true }).click();
    await adminPage.getByRole("button", { name: "保存评分" }).click();
    await expect(adminPage.getByText(/已保存评分/).first()).toBeVisible();

    /* ---------------------------------------------------- 发布成绩 */

    await adminPage.goto(`/admin/exam-sessions/${sessionId}`);
    await expect(adminPage.getByRole("heading", { name: "负责教师" })).toBeVisible();

    await adminPage.getByRole("button", { name: "发布成绩" }).click();
    await expect(adminPage.getByRole("heading", { name: "发布成绩" })).toBeVisible();
    await adminPage.getByRole("button", { name: "确认发布" }).click();
    await expect(adminPage.getByText(/已发布全部成绩/).first()).toBeVisible();

    /* ---------------------------------------------------- 学生看到成绩 */

    await studentPage.goto("/reports");
    const row = studentPage.getByRole("row", { name: new RegExp(examName) });
    await expect(row).toBeVisible();
    // 8 分满分 10 分——发布之前这里只看得见「待阅」，看不到定分。
    await expect(row).toContainText("8 / 10");
    await expect(row).toContainText("已完成");

    // 点「查看」进成绩报告，报告里也是同一个分。
    await row.getByRole("button", { name: "查看" }).click();
    await expect(studentPage).toHaveURL(new RegExp(`/exams/${sessionId}/report`));
    await expect(studentPage.getByText("当前总分")).toBeVisible();

    await studentContext.close();
    await adminContext.close();
  });
});
