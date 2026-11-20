/* ==========================================================================
   试卷版本快照（真实后端）
   --------------------------------------------------------------------------
   快照是**发布时冻结的一份卷面**：发布一次就是一个版本，
   之后改卷不影响已经发出去的版本。

   这条用例守的是三件事：
   1. 发布一次确实产生一个版本（版本列表接口之前没人调）；
   2. 快照里冻结着题目与正确答案（冻结的是「发出去那一刻的卷面」）；
   3. 指定版本与最新版本取回来的是同一份内容。

   **为什么必须在真实后端上验**：快照是后端在发布时冻结的，
   mock 模式里压根没有「发布」这一步，也就没有版本——
   这件事在 mock 上验不出来。
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

test.describe("试卷版本快照（真实后端）", () => {
  test("发布一次冻结一版卷面，之后能取回冻结的题目", async () => {
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
      code: `e2e-snapshot-question-${Date.now()}`,
      type: "single",
      stem: "端到端题目：快照用例，TCP 属于哪一层协议？",
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

    // 2. 建卷 → 加题位 → 发布。
    const paper = await api(admin, "POST", "/api/v1/papers", {
      kind: "exam",
      name: `端到端快照试卷-${Date.now()}`,
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

    // 3. 版本列表：发布一次就是一版。
    const snapshots = await api(admin, "GET", `/api/v1/papers/${paperId}/snapshots`);
    expectOk(snapshots, "试卷版本快照列表");
    const versions: any[] = snapshots.json?.items ?? [];
    expect(versions.length, "发布一次应当产生一个版本").toBe(1);
    expect(Number(versions[0].version), "第一个版本号应当是 1").toBe(1);
    expect(Number(versions[0].itemCount), "这一版有一道题").toBe(1);
    expect(versions[0].contentHash, "版本要有内容指纹").toBeTruthy();

    // 4. 最新一版：冻结的题目与正确答案都在。
    const latest = await api(admin, "GET", `/api/v1/papers/${paperId}/snapshots/latest`);
    expectOk(latest, "最新一版快照");
    const frozen: any[] = latest.json?.items ?? [];
    expect(frozen.length, "快照里应当有冻结的题目").toBe(1);
    expect(frozen[0].questionCode, "冻结的题目带题号").toBeTruthy();
    expect(
      (frozen[0].correctKeys ?? []).length,
      "快照里冻结着正确答案",
    ).toBeGreaterThan(0);

    // 5. 指定版本取回来的是同一份内容。
    const version = await api(admin, "GET", `/api/v1/papers/${paperId}/snapshots/1`);
    expectOk(version, "指定版本快照");
    expect(Number(version.json?.version), "指定版本应当是第 1 版").toBe(1);
    expect(version.json?.contentHash, "内容指纹要与列表里的一致").toBe(
      versions[0].contentHash,
    );
  });
});
