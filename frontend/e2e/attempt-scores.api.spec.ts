/* ==========================================================================
   一次作答的成绩与判分依据（真实后端）
   --------------------------------------------------------------------------
   `GET /attempts/{id}/scores` 给的是**逐题成绩 + 判分依据**：
   命中了哪些要点、漏了哪些、按什么方式判的分。

   这一组用例守的是三件事：
   1. 成绩没发布之前，服务端把主观题那部分（分数、要点命中）**捂着不给**
      —— 要点命中等于把答案抖出来（FR-GRD-05）；
   2. 发布成绩之后，主观题的分数与要点命中才出来；
   3. 要点命中与漏掉照服务端给的原样对得上。

   **为什么必须在真实后端上验**：判分与「发布成绩」的时机都在后端，
   mock 模式里没有发布成绩这一步，这件事在 mock 上验不出来。
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

/** 逐题明细里那道主观题的记录。 */
function subjectiveItem(json: any, questionId: number) {
  const items: any[] = json?.items ?? [];
  const found = items.find((item: any) => Number(item.questionId) === Number(questionId));
  expect(found, `逐题明细里应当有题目 ${questionId}`).toBeTruthy();
  return found;
}

test.describe("一次作答的成绩与判分依据（真实后端）", () => {
  test("发布成绩前主观题那部分捂着，发布之后分数与要点命中才出来", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    // 1. 建一道简答题：两个评分要点，考生只答中一个。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");
    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-scores-question-${Date.now()}`,
      type: "short",
      stem: "端到端题目：简述端到端传输的特点。",
      defaultScore: 10,
      difficultyTagId: difficulty!.id,
      keypoints: [
        { text: "端到端传输", keywords: ["端到端"] },
        { text: "可靠交付", keywords: ["可靠"] },
      ],
      analysis: "端到端用例的解析。",
    });
    expectOk(question, "建题");
    const questionId = question.json.question.id;

    const publishQuestion = await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});
    expectOk(publishQuestion, "发布题目");

    // 2. 组卷 → 发布。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端判分依据试卷-${Date.now()}`,
      targetTotalScore: 10,
      durationMinutes: 30,
      passScore: 6,
      orderRule: "by_type",
      variantRule: "standard",
      answerPolicy: "immediately",
    });
    expectOk(paper, "建卷");
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
    expectOk(publishPaper, "发布试卷");

    // 3. 建场次 → 发布场次 → 学生进场作答并交卷。
    const now = new Date();
    const session = await api(admin, "POST", "/api/v1/exam-sessions", {
      paperId,
      name: `端到端判分依据场次-${Date.now()}`,
      openAt: new Date(now.getTime() - 60_000).toISOString(),
      closeAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      durationMinutes: 30,
      participantMode: "direct",
      participantUserIds: [student.userId],
      variantRule: "standard",
    });
    expectOk(session, "建场次");
    const sessionId = session.json.session.id;

    const publishSession = await api(admin, "POST", `/api/v1/exam-sessions/${sessionId}/publish`, {});
    expectOk(publishSession, "发布场次");

    const start = await api(student, "POST", "/api/v1/attempts", { examSessionId: sessionId });
    expectOk(start, "学生进入考试");
    const attemptId = start.json.attemptId;

    // 只答中第一个要点。
    const save = await api(student, "POST", `/api/v1/attempts/${attemptId}/answers`, {
      clientSeq: 1,
      items: [
        {
          questionId,
          payload: { text: "这个协议是端到端传输的。" },
        },
      ],
      clientSentAt: new Date().toISOString(),
    });
    expectOk(save, "保存答案");

    const submit = await api(student, "POST", `/api/v1/attempts/${attemptId}/submit`, {});
    expectOk(submit, "交卷");

    // 4. 成绩还没发布：主观题那部分应当是捂着的。
    const before = await api(student, "GET", `/api/v1/attempts/${attemptId}/scores`);
    expectOk(before, "读逐题成绩");
    expect(
      before.json?.gradeVisibility,
      "成绩没发布时可见性不该是 published",
    ).not.toBe("published");

    const withheld = subjectiveItem(before.json, questionId);
    expect(withheld.score, "成绩没发布时主观题的分数应当是空的").toBeNull();
    expect(withheld.hitItems, "成绩没发布时要点命中应当是空的").toEqual([]);
    expect(withheld.missedItems, "成绩没发布时漏掉的要点也应当是空的").toEqual([]);

    // 5. 发布成绩：分数与要点命中这才出来。
    const publishGrades = await api(
      admin,
      "POST",
      `/api/v1/exam-sessions/${sessionId}/publish-grades`,
      { scope: "all" },
    );
    expectOk(publishGrades, "发布成绩");

    const after = await api(student, "GET", `/api/v1/attempts/${attemptId}/scores`);
    expectOk(after, "再读逐题成绩");
    expect(after.json?.gradeVisibility, "发布之后可见性是 published").toBe("published");

    const revealed = subjectiveItem(after.json, questionId);
    expect(Number(revealed.score), "发布之后主观题有分（两个要点命中一个）").toBe(5);
    expect(revealed.hitItems, "命中的要点是那个答对的").toEqual(["端到端传输"]);
    expect(revealed.missedItems, "漏掉的要点是那个没答上的").toEqual(["可靠交付"]);
    expect(revealed.method, "主观题是自动初判").toBe("auto_suggested");
    expect(revealed.methodLabel, "判分方式有中文名").toBeTruthy();
  });
});
