/* ==========================================================================
   归档试卷（真实后端）
   --------------------------------------------------------------------------
   归档是试卷生命周期的第三个动作：草稿 / 已发布 → 已归档。

   这一组用例守的是三件事：
   1. 归档之后，试卷的状态真的变成「已归档」，列表里也是这么显示的；
   2. 归档是幂等的：再归档一次不报错（管理员手滑点两下不该出事）；
   3. 归档的**实际后果**——这份试卷不能再用来发布新的考试场次。

   **为什么必须在真实后端上验**：mock 的试卷只有「进行中 / 未发布」，
   没有「已归档」这一档状态，这个端点在 mock 上压根不存在。
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

test.describe("归档试卷（真实后端）", () => {
  test("归档之后状态变成已归档，再归档一次也不报错", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端归档试卷-${Date.now()}`,
      targetTotalScore: 10,
      durationMinutes: 30,
      passScore: 6,
      orderRule: "by_type",
      variantRule: "standard",
      answerPolicy: "immediately",
    });
    expectOk(paper, "建卷");
    const paperId = paper.json.paper.id;

    // 归档。
    const archived = await api(admin, "POST", `/api/v1/papers/${paperId}/archive`, {});
    expectOk(archived, "归档试卷");
    expect(archived.json?.paper?.status, "归档之后状态是 archived").toBe("archived");
    expect(archived.json?.paper?.statusLabel, "中文名是「已归档」").toBe("已归档");

    // 再读一次：状态落库了。
    const reread = await api(admin, "GET", `/api/v1/papers/${paperId}`);
    expectOk(reread, "再读试卷");
    expect(reread.json?.paper?.status, "再读还是 archived").toBe("archived");

    // 列表里也是「已归档」——管理端显示的就是这个。
    const list = await api(admin, "GET", "/api/v1/papers?kind=exam&size=200");
    expectOk(list, "试卷列表");
    const row = (list.json?.items ?? []).find(
      (item: any) => Number(item.id) === Number(paperId),
    );
    expect(row, "列表里应当有这份试卷").toBeTruthy();
    expect(row.status, "列表里的状态是 archived").toBe("archived");
    expect(row.statusLabel, "列表里显示「已归档」").toBe("已归档");

    // 幂等：再归档一次不会报错（服务端只认「已经是归档」这一种情况）。
    const again = await api(admin, "POST", `/api/v1/papers/${paperId}/archive`, {});
    expectOk(again, "再归档一次");
    expect(again.json?.paper?.status, "再归档之后还是 archived").toBe("archived");
  });

  test("归档之后不能再用这份试卷发布新的考试场次", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const student = await ensureStudent(apiRoot, admin);
    const studentSession = await login(apiRoot, student.username, student.password);

    // 1. 建题并发布（题目要先发布才能入卷）。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");
    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-archive-question-${Date.now()}`,
      type: "single",
      stem: "端到端题目：归档用例，TCP 属于哪一层协议？",
      defaultScore: 10,
      difficultyTagId: difficulty!.id,
      options: [
        { key: "A", text: "传输层", isCorrect: true },
        { key: "B", text: "网络层", isCorrect: false },
      ],
      analysis: "端到端用例的解析。",
    });
    expectOk(question, "建题");
    const questionId = question.json.question.id;

    const publishQuestion = await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});
    expectOk(publishQuestion, "发布题目");

    // 2. 建卷 → 加题位 → 发布（先发布，才谈得上「归档之后不能再开新场次」）。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端归档场次试卷-${Date.now()}`,
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

    // 3. 归档。
    const archived = await api(admin, "POST", `/api/v1/papers/${paperId}/archive`, {});
    expectOk(archived, "归档试卷");
    expect(archived.json?.paper?.status, "归档之后状态是 archived").toBe("archived");

    // 4. 用这份试卷建场次：建场次不看试卷状态，但发布场次看。
    const now = new Date();
    const session = await api(admin, "POST", "/api/v1/exam-sessions", {
      paperId,
      name: `端到端归档场次-${Date.now()}`,
      openAt: new Date(now.getTime() - 60_000).toISOString(),
      closeAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      durationMinutes: 30,
      participantMode: "direct",
      participantUserIds: [studentSession.userId],
      variantRule: "standard",
    });
    expectOk(session, "建场次");
    const sessionId = session.json.session.id;

    // 5. 发布场次：试卷已归档，服务端应当拒。
    const publishSession = await api(
      admin,
      "POST",
      `/api/v1/exam-sessions/${sessionId}/publish`,
      {},
    );
    expect(publishSession.status, "归档后的试卷不该能发布考试场次").toBe(422);
    expect(publishSession.raw, "拒绝的原因要说清楚").toContain("试卷尚未发布");
  });
});
