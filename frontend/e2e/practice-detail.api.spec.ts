/* ==========================================================================
   一条练习开放单（真实后端）
   --------------------------------------------------------------------------
   `GET /practices/{id}` 给的是**一条**练习开放单——与列表里的一项是同一个
   DTO（服务端同一个 `PracticeSummaryDto`），区别是只取这一条。

   这一组用例守的是三件事：
   1. 看得见的开放单，按 ID 取回来与列表里那一项一致；
   2. **看不见的开放单取不到**（草稿 / 不在可见范围内 → 404）——
      可见范围由后端判，前端绕不过去；
   3. 练习会话要的是「这一条」，不是整张列表。

   **为什么必须在真实后端上验**：开放单的可见范围（谁看得见、上不上架）
   是后端的事，mock 模式没有这一层。
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

test.describe("一条练习开放单（真实后端）", () => {
  test("看得见的能按 ID 取回，看不见的取不到", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    // 1. 建题并发布（题目要先发布才能入卷）。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");
    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-practice-detail-question-${Date.now()}`,
      type: "single",
      stem: "端到端题目：练习详情用例，1 + 1 = ?",
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

    // 2. 建练习卷并发布（没发布的练习卷没有卷面快照）。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "practice",
      name: `端到端练习详情卷-${Date.now()}`,
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

    // 3. 建开放单（先是草稿，学生看不见）。
    const title = `端到端练习详情开放单-${Date.now()}`;
    const assignment = await api(admin, "POST", "/api/v1/practice-assignments", {
      paperId,
      title,
      scopeTagIds: [],
      openAt: null,
      closeAt: null,
    });
    expectOk(assignment, "建开放单");
    const assignmentId = assignment.json.id;

    // 草稿状态的开放单：学生按 ID 取也取不到（可见范围由后端判）。
    const beforePublish = await api(student, "GET", `/api/v1/practices/${assignmentId}`);
    expect(beforePublish.status, "草稿状态的开放单学生取不到").toBe(404);

    // 4. 上架：学生看得见，也能按 ID 取到。
    const publish = await api(admin, "POST", `/api/v1/practice-assignments/${assignmentId}/publish`, {});
    expectOk(publish, "上架开放单");

    const detail = await api(student, "GET", `/api/v1/practices/${assignmentId}`);
    expectOk(detail, "取回这一条练习");
    expect(Number(detail.json?.id), "取回的是这一条开放单").toBe(Number(assignmentId));
    expect(detail.json?.title).toBe(title);
    expect(Number(detail.json?.paperId), "指向我们建的那份练习卷").toBe(Number(paperId));
    expect(detail.json?.canStart, "上架后学生应该能开始作答").toBe(true);

    // 5. 与列表里那一项一致（同一个 DTO）。
    const list = await api(student, "GET", "/api/v1/practices?page=1&size=200");
    expectOk(list, "学生可见的练习列表");
    const row = (list.json?.items ?? []).find(
      (item: any) => Number(item.id) === Number(assignmentId),
    );
    expect(row, "列表里应当有这条练习").toBeTruthy();
    for (const key of Object.keys(detail.json ?? {})) {
      expect(row[key], `详情与列表的「${key}」应当一致`).toEqual(detail.json[key]);
    }
  });
});
