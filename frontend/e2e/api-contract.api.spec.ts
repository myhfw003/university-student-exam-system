/* ==========================================================================
   端到端流程 ⑤：接口全景巡检与越权访问
   --------------------------------------------------------------------------
   对应 T-P9-01「端到端测试」与《05-api.md》的契约约定。

   这一组用例打的是**真实后端**：接口全景巡检（每个接口都不能 5xx，
   错误响应必须符合 ProblemDetails 约定）与越权访问（没有权限的令牌
   必须被拒）。这两件事在 mock 模式下验不出来——mock 根本没有鉴权层。

   契约来自 docs/api/openapi.json（CI 校验它与代码一致），
   接口要求的权限码由契约里的 x-required-permission 给出。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import {
  adminPassword,
  adminUsername,
  apiRoot,
  ensureStudent,
  login,
  readOpenApiDocument,
  type OpenApiOperation,
  type Session,
} from "./setup/api";

/** 路径参数统一用不存在的 id：巡检不产生副作用，只验「接口活着且不 5xx」。 */
const MISSING_ID = "999999999";

interface Operation {
  method: string;
  path: string;
  operation: OpenApiOperation;
}

/** 从契约里列出全部接口。 */
function listOperations(): Operation[] {
  const document = readOpenApiDocument();
  const methods = ["get", "post", "put", "delete", "patch"];
  const result: Operation[] = [];

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method];

      if (!operation) continue;

      result.push({ method: method.toUpperCase(), path, operation });
    }
  }

  return result;
}

/** 把路径里的 {id} 换成不存在的 id。 */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, MISSING_ID);
}

/**
 * 是否是文件上传接口。
 * <para>
 * 文件上传接口的路由带 content-type 约束：请求的 content-type 不匹配，
 * 路由直接不匹配这个端点，返回 415，**根本走不到鉴权**。
 * 这不是漏洞（端点没被执行），但巡检必须按契约里的 content-type 发请求，
 * 否则测到的不是鉴权行为，而是路由行为。
 * </para>
 */
function isMultipart(operation: OpenApiOperation): boolean {
  const body = operation.requestBody as { content?: Record<string, unknown> } | undefined;

  return Object.keys(body?.content ?? {}).some((type) => type.includes("multipart"));
}

/** 巡检请求：带令牌，body 按契约给（参数校验会拒，那是合法结果）。 */
async function call(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  operation: OpenApiOperation,
): Promise<{ status: number; body: string }> {
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  const multipart = hasBody && isMultipart(operation);

  const headers: Record<string, string> = {};

  if (token) headers.Authorization = `Bearer ${token}`;

  // multipart 的 content-type 由浏览器/FormData 自己带（带 boundary），
  // 手写会漏掉 boundary，服务端直接拒。
  if (hasBody && !multipart) headers["Content-Type"] = "application/json";

  const body = multipart
    ? (() => {
        const form = new FormData();
        form.append("file", new Blob(["e2e"]), "e2e.txt");
        return form;
      })()
    : hasBody
      ? "{}"
      : undefined;

  const response = await fetch(`${baseUrl}${concretePath(path)}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  return { status: response.status, body: await response.text() };
}

test.describe("接口全景巡检（真实后端）", () => {
  let admin: Session;
  let student: Session;

  test.beforeAll(async () => {
    admin = await login(apiRoot, adminUsername, adminPassword);
    const account = await ensureStudent(apiRoot, admin);
    student = await login(apiRoot, account.username, account.password);
  });

  test("每个接口都不 5xx，且错误响应符合契约约定", async () => {
    const failures: string[] = [];
    const operations = listOperations();

    expect(operations.length).toBeGreaterThan(100);

    for (const { method, path, operation } of operations) {
      // 巡检里会真的调一次「登出」：登出必须立刻吊销当前令牌（这是对的行为），
      // 所以之后的请求会拿到 401——重新登录再来一次，而不是把 401 当成故障。
      let { status, body } = await call(apiRoot, admin.token, method, path, operation);

      if (status === 401) {
        admin = await login(apiRoot, adminUsername, adminPassword);
        ({ status, body } = await call(apiRoot, admin.token, method, path, operation));
      }

      // 5xx = 接口在真实环境下炸了：这是巡检要抓的头号问题。
      if (status >= 500) {
        failures.push(`${method} ${path} → HTTP ${status} ${body.slice(0, 200)}`);
        continue;
      }

      if (status < 400) continue;

      // 错误响应必须是 ProblemDetails 形状：status 与 title 都要有。
      let parsed: Record<string, unknown> | undefined;

      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        failures.push(`${method} ${path} → HTTP ${status} 响应不是 JSON：${body.slice(0, 200)}`);
        continue;
      }

      if (typeof parsed.status !== "number" || typeof parsed.title !== "string") {
        failures.push(
          `${method} ${path} → 错误响应缺少 status/title：${body.slice(0, 200)}`,
        );
        continue;
      }

      if (parsed.status !== status) {
        failures.push(
          `${method} ${path} → 响应体 status(${parsed.status}) 与 HTTP 状态码(${status}) 不一致`,
        );
        continue;
      }

      if (parsed.errorCode !== undefined && typeof parsed.errorCode !== "number") {
        failures.push(`${method} ${path} → errorCode 不是数字`);
        continue;
      }

      expect(operation.summary, `${method} ${path} 缺少接口说明`).toBeTruthy();
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("越权访问：没有权限的令牌必须被拒", async () => {
    const failures: string[] = [];
    const granted = new Set(student.permissions);
    let checked = 0;

    for (const { method, path, operation } of listOperations()) {
      const required = operation["x-required-permission"];

      // 没有标注权限码的接口（登录、当前用户等）不在越权范围内。
      if (!required) continue;

      // 学生本来就有这个权限：不构成越权。
      if (granted.has(required)) continue;

      checked += 1;

      const { status } = await call(apiRoot, student.token, method, path, operation);

      if (status !== 401 && status !== 403) {
        failures.push(
          `${method} ${path}（需 ${required}）→ 学生令牌得到 HTTP ${status}，应当 401/403`,
        );
      }
    }

    expect(checked, "没有可用于越权断言的接口").toBeGreaterThan(50);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("未登录的请求一律 401", async () => {
    const failures: string[] = [];

    for (const { method, path, operation } of listOperations()) {
      if (!operation["x-required-permission"]) continue;

      const { status } = await call(apiRoot, "", method, path, operation);

      if (status !== 401) {
        failures.push(`${method} ${path} → 未登录得到 HTTP ${status}，应当 401`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
