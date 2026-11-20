/* ==========================================================================
   练习开放单：管理端上架 → 学生端可见（真实后端）
   --------------------------------------------------------------------------
   这条用例守的是**开放单这条链路本身**：

     建题 → 发布 → 建练习卷 → 发布练习卷 → 建开放单（草稿）
       → 上架 → 学生看到这份练习 → 下架 → 学生立刻看不到

   **为什么必须在真实后端上验**：学生端读的是 `GET /practices`，
   而服务端按「已上架 + 在开放期内 + 范围匹配」过滤开放单——
   这套过滤在前端 mock 里根本没有（mock 的学生可见性按练习卷自身走）。
   前端能不能把「上架 / 下架」正确地打到后端，也只能在这里验。

   顺带把管理端列表接口一起验了：状态、开放范围与开放期要回得来。
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

/** 一次请求：带上令牌，返回状态与解析后的 JSON（失败时把原文带出来）。 */
async function api(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; raw: string }> {
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

  return { status: response.status, json, raw };
}

/** 断言成功，并把响应体带进失败信息。 */
function expectOk(result: { status: number; raw: string }, what: string) {
  expect(result.status, `${what} → HTTP ${result.status}: ${result.raw}`).toBeLessThan(300);
}

/** 学生可见的练习列表里有没有这一条。 */
async function studentSeesPractice(
  student: Session,
  title: string,
): Promise<{ seen: boolean; item: any }> {
  const list = await api(student, "GET", "/api/v1/practices");
  expectOk(list, "学生练习列表");
  const items: any[] = list.json?.items ?? [];
  const item = items.find((row) => row.title === title);
  return { seen: Boolean(item), item };
}

test.describe("练习开放单（真实后端）", () => {
  test("上架后学生看得到这份练习，下架后立刻看不到", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    // 1. 建题并发布（建题要挂难度标签）。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");
    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-practice-question-${Date.now()}`,
      type: "single",
      stem: "端到端题目：练习开放单专用题目，1 + 1 = ?",
      defaultScore: 10,
      difficultyTagId: difficulty!.id,
      options: [
        { key: "A", text: "2", isCorrect: true },
        { key: "B", text: "3", isCorrect: false },
      ],
      analysis: "端到端用例的解析。",
    });
    expectOk(question, "建题");
    const questionId = question.json.question.id;

    const publishQuestion = await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});
    expectOk(publishQuestion, "发布题目");

    // 2. 建练习卷并发布（没发布的练习卷没有卷面快照，学生做了也做不了）。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "practice",
      name: `端到端练习卷-${Date.now()}`,
      targetTotalScore: 10,
      durationMinutes: 30,
      passScore: null,
      orderRule: "by_type",
      variantRule: "standard",
      answerPolicy: "immediately",
      practiceRules: {
        maxAttempts: 0,
        feedbackTiming: "after_submit",
        reflowMistakes: true,
        suggestedMinutes: 30,
      },
    });
    expectOk(paper, "建练习卷");
    const paperId = paper.json.paper.id;

    const addItem = await api(admin, "POST", `/api/v1/papers/${paperId}/items`, {
      questionId,
      score: 10,
      sortOrder: 1,
    });
    expectOk(addItem, "加题位");

    const publishPaper = await api(admin, "POST", `/api/v1/papers/${paperId}/publish`, {
      warningOverrideReason: "端到端用例：只放一道题用于验证流程。",
    });
    expectOk(publishPaper, "发布练习卷");

    // 3. 建开放单：默认是草稿。
    const title = `端到端开放单-${Date.now()}`;
    const assignment = await api(admin, "POST", "/api/v1/practice-assignments", {
      paperId,
      title,
      scopeTagIds: [],
      openAt: null,
      closeAt: null,
    });
    expectOk(assignment, "建开放单");
    const assignmentId = assignment.json.id;
    expect(assignment.json.status, "新建的开放单应是草稿").toBe("draft");

    // 4. 草稿状态：学生看不见（开放单没上架）。
    const beforePublish = await studentSeesPractice(student, title);
    expect(beforePublish.seen, "草稿状态的开放单不该被学生看到").toBe(false);

    // 5. 上架：学生立刻看到这份练习。
    const publish = await api(admin, "POST", `/api/v1/practice-assignments/${assignmentId}/publish`, {});
    expectOk(publish, "上架开放单");
    expect(publish.json.status, "上架后状态应是已上架").toBe("published");

    const afterPublish = await studentSeesPractice(student, title);
    expect(afterPublish.seen, "上架后学生应看到这份练习").toBe(true);
    expect(afterPublish.item?.canStart, "上架后学生应该能开始作答").toBe(true);
    expect(Number(afterPublish.item?.paperId), "学生看到的应是我们建的那份练习卷").toBe(Number(paperId));

    // 6. 管理端列表：状态、开放范围与开放期要回得来。
    const list = await api(admin, "GET", "/api/v1/practice-assignments?status=published");
    expectOk(list, "管理端开放单列表");
    const listed = (list.json?.items ?? []).find((row: any) => Number(row.id) === Number(assignmentId));
    expect(listed, "管理端列表里没有刚上架的开放单").toBeTruthy();
    expect(listed.title).toBe(title);
    expect(Array.isArray(listed.scopeTagIds)).toBe(true);
    expect(listed.scopeTagIds.length, "开放范围为空表示全员开放").toBe(0);

    // 7. 下架：学生立刻看不到（已做过的记录不受影响）。
    const archive = await api(admin, "POST", `/api/v1/practice-assignments/${assignmentId}/archive`, {});
    expectOk(archive, "下架开放单");
    expect(archive.json.status, "下架后状态应是已下架").toBe("archived");

    const afterArchive = await studentSeesPractice(student, title);
    expect(afterArchive.seen, "下架后学生不该再看到这份练习").toBe(false);
  });

  test("开放单只能挂练习卷：挂考试卷会被拒", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    // 考试卷：kind = exam。
    const exam = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端考试卷-${Date.now()}`,
      targetTotalScore: 10,
      durationMinutes: 30,
      passScore: 6,
      orderRule: "by_type",
      variantRule: "standard",
      answerPolicy: "immediately",
    });
    expectOk(exam, "建考试卷");

    const assignment = await api(admin, "POST", "/api/v1/practice-assignments", {
      paperId: exam.json.paper.id,
      title: "挂错卷的开放单",
      scopeTagIds: [],
      openAt: null,
      closeAt: null,
    });

    expect(assignment.status, "挂考试卷应当被拒").toBeGreaterThanOrEqual(400);
    expect(assignment.raw, "拒绝的原因要说清楚").toContain("练习只能挂练习类型的试卷");
  });
});
