/* ==========================================================================
   导入批次：上传 → 列表 → 重新打开（真实后端）
   --------------------------------------------------------------------------
   这一组用例守的是**导入批次这条链路**：

     上传文件（服务端解析）→ 批次列表 → 重新打开批次拿回逐行结果 → 采纳

   **为什么必须在真实后端上验**：逐行结果存在服务端，
   前端上传当次拿得到，过一阵再回来看同一个批次就得重新取
   （`GET /imports/{id}`）。mock 模式里整份批次就在本地，
   验不出「重新打开还能不能拿回逐行结果」这件事。

   CSV 格式：首行是表头（题号/题干/题型/选项/答案/解析/难度），
   选项用 `|` 分隔（`A. 甲|B. 乙`）。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login, type Session } from "./setup/api";

/** 一次 JSON 请求。 */
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

/**
 * 两行的 CSV：一行合法，一行缺题型（要报错但不阻断整批）。
 *
 * 题号**每次跑都要不一样**：题目按题号唯一，跑第二遍时上一遍留下的
 * 题目还在，采纳会把这一行当重复跳过，采纳数就成了 0。
 */
function csvOf(runId: string): string {
  return [
    "题号,题干,题型,选项,答案,解析,难度",
    `Q-E2E-${runId},端到端导入的行：1 + 1 = ?,单选,A. 2|B. 3,A,端到端用例的解析,基础`,
    `Q-E2E-${runId}-BAD,端到端导入的坏行：没有题型,,,,,`,
  ].join("\n");
}

test.describe("导入批次（真实后端）", () => {
  test("上传后重新打开批次，逐行结果还在", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    // 1. 上传：服务端解析，给出逐行结果。
    const runId = String(Date.now());
    const form = new FormData();
    form.append(
      "file",
      new Blob([csvOf(runId)], { type: "text/csv" }),
      `e2e-import-${runId}.csv`,
    );
    const uploadResponse = await fetch(`${apiRoot}/api/v1/imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form,
    });
    const uploadRaw = await uploadResponse.text();
    expect(uploadResponse.status, `上传导入文件 → HTTP ${uploadResponse.status}: ${uploadRaw}`).toBeLessThan(300);
    const uploaded = JSON.parse(uploadRaw);

    const batchId = uploaded.batch.id;
    expect(uploaded.rows.length, "上传后应当有两行的逐行结果").toBe(2);
    expect(uploaded.rows[0].valid, "第一行应当合法").toBe(true);
    expect(uploaded.rows[1].valid, "第二行缺题型，应当不合法").toBe(false);
    expect(
      (uploaded.rows[1].errors ?? []).length,
      "不合法的行要给出错误明细",
    ).toBeGreaterThan(0);

    // 2. 批次列表：刚上传的批次在里面。
    const list = await api(admin, "GET", "/api/v1/imports?size=20");
    expectOk(list, "导入批次列表");
    const listed = (list.json?.items ?? []).find((row: any) => Number(row.id) === Number(batchId));
    expect(listed, "批次列表里没有刚上传的批次").toBeTruthy();
    expect(Number(listed.totalRows), "列表里的总行数应当是 2").toBe(2);

    // 3. 重新打开批次：逐行结果要拿得回来（这就是管理端「打开」按钮打的那个端点）。
    const detail = await api(admin, "GET", `/api/v1/imports/${batchId}`);
    expectOk(detail, "导入批次详情");
    expect(detail.json?.batch?.id, "批次详情里的批次 ID 不对").toBeDefined();
    expect(detail.json?.rows?.length, "重新打开后逐行结果没了").toBe(2);
    expect(detail.json.rows[0].valid, "重新打开后第一行仍应合法").toBe(true);
    expect(detail.json.rows[1].valid, "重新打开后第二行仍不合法").toBe(false);

    // 4. 采纳：只采纳合法的行。
    const adopt = await api(admin, "POST", `/api/v1/imports/${batchId}/adopt`, {});
    expectOk(adopt, "采纳导入批次");
    expect(Number(adopt.json?.adopted), "应当采纳 1 道（只有合法的那行）").toBe(1);

    // 5. 采纳之后状态变成已采纳。
    const after = await api(admin, "GET", `/api/v1/imports/${batchId}`);
    expectOk(after, "再次读取导入批次");
    expect(after.json?.batch?.status, "采纳后批次状态应是已采纳").toBe("adopted");
  });
});
