/* ==========================================================================
   卷型模板详情（真实后端）
   --------------------------------------------------------------------------
   模板是「一份试卷存起来的题位清单」：名称、适用类型、卷型、时长、分值配置，
   以及**题位清单**（需求 FR-AUT-07）。

   这一组用例守的是三件事：
   1. 把一份试卷存成模板之后，能按 ID 取回它的详情；
   2. 题位清单与试卷当时的题位一致（题目 ID 与分值都对得上）；
   3. 模板列表里有它——详情不是悬空的。

   **为什么必须在真实后端上验**：模板的题位存在后端的模板表里，
   mock 模式的模板是本地数据，接不接后端都验不出这件事。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login, type Session } from "./setup/api";

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

test.describe("卷型模板详情（真实后端）", () => {
  test("存成模板之后能取回详情，题位清单与试卷一致", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    // 1. 建题并发布（题目要先发布才能入卷）。
    const tags = await api(admin, "GET", "/api/v1/tags");
    expectOk(tags, "读取标签");
    const allTags: { id: number; code: string; name: string }[] = (tags.json?.groups ?? []).flatMap(
      (group: any) => group.tags ?? [],
    );
    const difficulty = allTags.find((tag) => tag.code === "difficulty.basic");
    expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

    const question = await api(admin, "POST", "/api/v1/questions", {
      code: `e2e-template-question-${Date.now()}`,
      type: "single",
      stem: "端到端题目：模板用例，TCP 属于哪一层协议？",
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

    // 2. 建卷 → 加题位。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端模板试卷-${Date.now()}`,
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

    // 3. 存成模板。
    const templateName = `端到端模板-${Date.now()}`;
    const created = await api(admin, "POST", "/api/v1/paper-templates", {
      paperId,
      name: templateName,
    });
    expectOk(created, "存成模板");
    const templateId = created.json.template.id;
    expect(created.json?.template?.name, "模板名就是给的那个").toBe(templateName);
    expect(Number(created.json?.template?.itemCount), "模板有一道题").toBe(1);

    // 4. 按 ID 取回详情：题位清单与试卷当时的题位一致。
    const detail = await api(admin, "GET", `/api/v1/paper-templates/${templateId}`);
    expectOk(detail, "取回模板详情");
    expect(detail.json?.template?.id, "取回的是同一个模板").toBe(templateId);
    expect(detail.json?.template?.name).toBe(templateName);
    expect(Number(detail.json?.template?.itemCount), "摘要里的题量是 1").toBe(1);
    expect(Number(detail.json?.template?.totalScore), "摘要里的总分是 10").toBe(10);

    const items: any[] = detail.json?.items ?? [];
    expect(items.length, "题位清单里有一道题").toBe(1);
    expect(Number(items[0].questionId), "题位指向那道题").toBe(Number(questionId));
    expect(Number(items[0].score), "题位的分值是 10").toBe(10);

    // 5. 列表里有它——详情不是悬空的。
    const list = await api(admin, "GET", "/api/v1/paper-templates?kind=exam&size=200");
    expectOk(list, "模板列表");
    const row = (list.json?.items ?? []).find(
      (item: any) => Number(item.id) === Number(templateId),
    );
    expect(row, "列表里应当有这份模板").toBeTruthy();
    expect(row.name, "列表里是同一个模板名").toBe(templateName);
  });
});
