/* ==========================================================================
   端到端流程：考试全生命周期（真实后端）
   --------------------------------------------------------------------------
   对应 T-P9-01 的「考试全流程」「组卷全流程」「切屏强制交卷」。

   这一条把整条业务链路在真实后端上走一遍：

     建题 → 组卷（题位）→ 发布试卷 → 建场次并指定考生 → 发布场次
       → 学生进入考试 → 保存答案 → 切屏 3 次 → 服务端强制交卷
       → 教师查成绩 → 发布成绩 → 学生看到成绩

   切屏计数与强制交卷**由服务端裁决**（客户端只上报不判定），
   所以这条用例只能打真实后端。
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

test.describe("考试全生命周期（真实后端）", () => {
  test("建题 → 组卷 → 发布 → 考试 → 切屏强制交卷 → 发布成绩 → 学生看到成绩", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    const student = await login(apiRoot, account.username, account.password);

    // 1. 难度标签：建题必须挂一个难度标签（种子里预置了三档）。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");

    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");

    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    // 2. 建题：单选，两个选项，其中 A 正确。
    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-question-${Date.now()}`,
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
    expectOk(question, "建题");
    const questionId = question.json.question.id;

    // 题目要先发布才能入卷（业务规则：未发布的题不进卷）。
    const publishQuestion = await api(
      admin,
      "POST",
      `/api/v1/questions/${questionId}/publish`,
      {},
    );
    expectOk(publishQuestion, "发布题目");

    // 3. 组卷：建卷 → 加题位 → 发布。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端试卷-${Date.now()}`,
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

    // 发布校验有警告项时必须填写覆盖理由（这里只有一道题，题均时长会超区间）。
    const publishPaper = await api(admin, "POST", `/api/v1/papers/${paperId}/publish`, {
      warningOverrideReason: "端到端用例：只放一道题用于验证流程。",
    });
    expectOk(publishPaper, "发布试卷");

    // 4. 建场次并指定考生：名单直接给用户 id（participantMode=direct）。
    const now = new Date();
    const session = await api(admin, "POST", "/api/v1/exam-sessions", {
      paperId,
      name: `端到端场次-${Date.now()}`,
      openAt: new Date(now.getTime() - 60_000).toISOString(),
      closeAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      durationMinutes: 30,
      participantMode: "direct",
      participantUserIds: [student.userId],
      variantRule: "standard",
      rules: {
        maxFocusLoss: 3,
        enableHeartbeatCheck: true,
        heartbeatIntervalSeconds: 15,
        heartbeatTimeoutSeconds: 45,
        maxDisconnect: 10,
        earlyEntryMinutes: 0,
      },
    });
    expectOk(session, "建场次");
    const sessionId = session.json.session.id;

    const publishSession = await api(
      admin,
      "POST",
      `/api/v1/exam-sessions/${sessionId}/publish`,
      {},
    );
    expectOk(publishSession, "发布场次");

    // 5. 学生进入考试。
    const start = await api(student, "POST", "/api/v1/attempts", { examSessionId: sessionId });
    expectOk(start, "学生进入考试");
    const attemptId = start.json.attemptId;

    // 6. 保存答案（走完整的批量保存协议：clientSeq + items）。
    const save = await api(student, "POST", `/api/v1/attempts/${attemptId}/answers`, {
      clientSeq: 1,
      items: [
        {
          questionId,
          payload: { selectedOptionKeys: ["A"] },
        },
      ],
      clientSentAt: new Date().toISOString(),
    });
    expectOk(save, "保存答案");

    // 7. 切屏 3 次：超过上限后由服务端强制交卷。
    for (let i = 0; i < 3; i += 1) {
      const focus = await api(student, "POST", `/api/v1/attempts/${attemptId}/focus-events`, {
        events: [{ type: "window_blur", clientAt: new Date().toISOString() }],
      });
      expectOk(focus, `第 ${i + 1} 次切屏上报`);
    }

    // 8. 服务端裁决：会话已交卷（强制交卷）。
    const afterFocus = await api(student, "GET", `/api/v1/attempts/${attemptId}`);
    expectOk(afterFocus, "查询会话状态");

    expect(
      ["submitted", "force_submitted", "auto_submitted"],
      `切屏 3 次后会话状态应为已交卷，实际是 ${afterFocus.json?.status}`,
    ).toContain(afterFocus.json?.status);

    // 9. 教师查成绩：答案已判分（客观题立即判分）。
    const grades = await api(admin, "GET", `/api/v1/exam-sessions/${sessionId}/grades`);
    expectOk(grades, "查询场次成绩");

    const rows: any[] = Array.isArray(grades.json?.items) ? grades.json.items : [];
    expect(rows.length, "场次成绩里没有这次作答").toBeGreaterThan(0);
    expect(Number(rows[0].score ?? rows[0].totalScore ?? 0), "客观题应已判分").toBeGreaterThan(0);

    // 10. 发布成绩。
    const publishGrades = await api(
      admin,
      "POST",
      `/api/v1/exam-sessions/${sessionId}/publish-grades`,
      { scope: "all" },
    );
    expectOk(publishGrades, "发布成绩");

    // 11. 学生看到成绩。
    const results = await api(student, "GET", "/api/v1/my/results");
    expectOk(results, "学生成绩列表");

    const published = (results.json?.items ?? []).some(
      (row: any) => Number(row.attemptId) === Number(attemptId),
    );
    expect(published, "学生没看到刚发布的成绩").toBe(true);

    const row = (results.json?.items ?? []).find((item: any) => Number(item.attemptId) === Number(attemptId));
    expect(Number(row?.totalScore ?? 0), "学生看到的成绩应是满分").toBeGreaterThan(0);
    expect(row?.status, "成绩应是已发布状态").toBe("published");
  });
});
