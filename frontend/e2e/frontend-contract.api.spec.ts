/* ==========================================================================
   前端 API 适配层 ↔ 真实后端（联调契约测试）
   --------------------------------------------------------------------------
   这一组用例不是「直接打接口」，而是**用前端自己的适配层**打真实后端：

     ENDPOINTS 常量 → httpClient → catalogApi / answerPayload 映射

   覆盖的正是联调里最容易错、又最容易被 mock 掩盖的东西：

   1. 端点路径与 docs/api/openapi.json 逐条对齐（防双前缀、防路由改名）；
   2. /auth/me 是扁平 UserProfileDto（不是 { user } 包装）；
   3. 刷新令牌走 HttpOnly Cookie（`rt`）；
   4. 标签分组 / 题目摘要 / 试卷详情映射到前端领域对象；
   5. 作答载荷 clientSeq、selectedOptionKeys、steps.code 的线格式；
   6. 监考快照的真实字段与状态词表；
   7. 修改本人密码（FR-IAM-03）端到端可用。

   运行：先起 compose 栈，再 `E2E_API_BASE_URL=http://127.0.0.1:8080 pnpm e2e:api`。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import {
  adminPassword,
  adminUsername,
  apiRoot,
  ensureStudent,
  login,
  readOpenApiDocument,
  type Session,
} from "./setup/api";
import {
  clearTokens,
  createHttpClient,
  ENDPOINTS,
  HttpError,
  loadCatalogSnapshot,
  loadMyExamSessions,
  setTokens,
  toDomainPayload,
  toServerAnswerBatch,
} from "../shared/src/api/index";

/** API 根地址：ENDPOINTS 是相对路径，基地址必须带上 `/api/v1`。 */
const apiBase = `${apiRoot}/api/v1`;
const client = createHttpClient({ baseUrl: apiBase });

/** 契约里的路径参数名各不相同（{id} / {examSessionId}），比较前统一。 */
function normalizePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{id}");
}

let admin: Session;
let student: Session;

test.beforeAll(async () => {
  admin = await login(apiRoot, adminUsername, adminPassword);
  const account = await ensureStudent(apiRoot, admin);
  student = await login(apiRoot, account.username, account.password);
  setTokens({ accessToken: admin.token });
});

test.afterAll(() => clearTokens());

test.describe("前端适配层联调", () => {
  test("端点常量与 OpenAPI 契约逐条对齐，且没有双前缀", () => {
    const document = readOpenApiDocument();
    const paths = new Set(Object.keys(document.paths).map(normalizePath));

    const endpoints = [
      ENDPOINTS.auth.login,
      ENDPOINTS.auth.refresh,
      ENDPOINTS.auth.logout,
      ENDPOINTS.auth.me,
      ENDPOINTS.auth.changePassword,
      ENDPOINTS.system.time,
      ENDPOINTS.catalog.tags,
      ENDPOINTS.catalog.banks,
      ENDPOINTS.catalog.questions,
      ENDPOINTS.catalog.questionFilters,
      ENDPOINTS.catalog.papers,
      ENDPOINTS.delivery.examSessions,
      ENDPOINTS.delivery.practices,
      ENDPOINTS.delivery.practiceAssignments,
      ENDPOINTS.delivery.attempts,
      ENDPOINTS.delivery.monitoring("{id}"),
      ENDPOINTS.learning.myResults,
      ENDPOINTS.learning.attemptsReport("{id}"),
      ENDPOINTS.learning.mistakes,
      ENDPOINTS.learning.dashboard,
      ENDPOINTS.learning.abilityProfile,
      ENDPOINTS.admin.users,
      ENDPOINTS.admin.resetPassword("{id}"),
      ENDPOINTS.admin.roles,
      ENDPOINTS.admin.permissions,
      ENDPOINTS.admin.settings,
      ENDPOINTS.admin.auditLogs,
      ENDPOINTS.admin.reviewTasks,
      ENDPOINTS.admin.statisticsBySession("{id}"),
      ENDPOINTS.admin.statisticsByQuestion("{id}"),
    ];

    const missing = endpoints.filter((endpoint) => !paths.has(normalizePath(`/api/v1${endpoint}`)));

    expect(missing, `契约里缺少这些端点：${missing.join(", ")}`).toEqual([]);

    for (const endpoint of endpoints) {
      expect(endpoint.startsWith("/api/v1/"), `${endpoint} 不应自带 /api/v1 前缀`).toBe(false);
    }
  });

  test("登录、扁平 /auth/me 与 HttpOnly Cookie 刷新", async () => {
    const loginResponse = await fetch(`${apiBase}${ENDPOINTS.auth.login}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    });

    expect(loginResponse.status).toBe(200);

    const body = (await loginResponse.json()) as { accessToken?: string };
    expect(body.accessToken).toBeTruthy();

    const setCookie = loginResponse.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    expect(cookie, "登录应下发 HttpOnly 刷新 Cookie（rt）").toContain("rt=");

    // /auth/me 返回扁平 UserProfileDto；旧适配层按 { user } 解包会永远匿名。
    setTokens({ accessToken: body.accessToken });
    const me = await client.get<{
      username?: string;
      roles?: string[];
      permissions?: string[];
    }>(ENDPOINTS.auth.me);

    expect(me.username).toBe(adminUsername);
    expect(Array.isArray(me.roles)).toBe(true);
    expect(Array.isArray(me.permissions)).toBe(true);

    // 只带 Cookie、不带 Bearer 也能换发访问令牌。
    const refreshed = await client.post<{ accessToken?: string }>(
      ENDPOINTS.auth.refresh,
      undefined,
      { auth: false, headers: { Cookie: cookie } },
    );
    expect(refreshed.accessToken).toBeTruthy();

    setTokens({ accessToken: admin.token });
  });

  test("内容目录映射：标签分组、题目摘要、试卷详情", async () => {
    setTokens({ accessToken: admin.token });

    const snapshot = await loadCatalogSnapshot(client);

    expect(snapshot.tags.length).toBeGreaterThan(0);
    expect(snapshot.tags.every((tag) => tag.id !== "" && tag.name !== "")).toBe(true);
    // 组织维度只挂用户，不应混进内容目录。
    expect(snapshot.tags.some((tag) => tag.group === "organization")).toBe(false);

    expect(snapshot.questions.length).toBeGreaterThan(0);
    const question = snapshot.questions[0]!;
    expect(question.id).not.toBe("");
    expect(question.stem.length).toBeGreaterThan(0);
    expect(question.score).toBeGreaterThan(0);
    // 列表接口不返回答案/解析：适配层必须留空，不能臆造。
    expect(question.answer).toEqual([]);
    expect(question.analysis).toBe("");

    expect(snapshot.exams.length).toBeGreaterThan(0);
    const published = snapshot.exams.find((exam) => exam.published);
    expect(published, "种子数据里应有已发布的考试卷").toBeTruthy();
    expect(published!.durationMin).toBeGreaterThan(0);
    expect(published!.totalScore).toBeGreaterThan(0);
    expect(published!.items.length).toBe(published!.questionIds.length);

    // 题库摘要不做 N+1 补齐，清单字段保守留空。
    expect(snapshot.banks.every((bank) => bank.questionIds.length === 0)).toBe(true);
  });

  test("学生视角：单个目录来源无权限时，其余目录照常加载", async () => {
    // 学生没有 bank:read：题库来源 403 不应拖垮其余目录。
    setTokens({ accessToken: student.token });
    const snapshot = await loadCatalogSnapshot(client);

    expect(snapshot.banks).toEqual([]);
    expect(snapshot.tags.length).toBeGreaterThan(0);

    // 题目与试卷对考生是**按范围**给的：矩阵里学生不进题库，
    // 试卷只看得到自己场次与练习挂着的那些，所以这里可能为空——
    // 断言「加载没被拖垮」而不是「一定有内容」。
    expect(Array.isArray(snapshot.questions)).toBe(true);
    expect(Array.isArray(snapshot.exams)).toBe(true);

    setTokens({ accessToken: admin.token });
  });

  test("作答载荷线格式：clientSeq / selectedOptionKeys / steps.code", async () => {
    const batch = toServerAnswerBatch({
      attemptId: "1",
      clientSeq: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      items: [
        { questionId: "12", payload: { selectedOptionKey: "B" } },
        { questionId: "13", payload: { selectedOptionKeys: ["C", "A"] } },
        {
          questionId: "14",
          payload: { steps: [{ stepCode: "s1", text: "先列式再求值" }] },
        },
      ],
    });

    expect(batch.clientSeq).toBe(7);
    expect(batch.clientSentAt).toBe("2026-01-01T00:00:00.000Z");
    // 题目 ID 必须是数字，JSON 字符串不会被后端绑定成 long。
    expect(batch.items[0]).toEqual({
      questionId: 12,
      payload: { selectedOptionKeys: ["B"] },
    });
    expect(batch.items[1]!.payload.selectedOptionKeys).toEqual(["A", "C"]);
    expect(batch.items[2]!.payload.steps).toEqual([{ code: "s1", text: "先列式再求值" }]);

    // 服务端载荷回填本地：单值还原成 selectedOptionKey。
    expect(toDomainPayload({ selectedOptionKeys: ["A"] })).toEqual({
      selectedOptionKey: "A",
    });

    // 真正把前端组装的请求体发给后端：路由存在、模型绑定通过、
    // 不存在的会话返回 404，而不是 400（绑定失败）。
    let status: number | undefined;
    try {
      await client.post<unknown>(`${ENDPOINTS.delivery.attempts}/999999999/answers`, batch, {
        auth: false,
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    } catch (error) {
      status = error instanceof HttpError ? error.status : undefined;
    }

    expect(status, "不存在的会话应当是 404（说明请求体已成功绑定）").toBe(404);
  });

  test("监考快照：真实字段与状态词表", async () => {
    setTokens({ accessToken: admin.token });

    const sessions = await client.get<{
      items?: Array<{ id: number; name?: string }>;
    }>(ENDPOINTS.delivery.examSessions);

    const session = (sessions.items ?? [])[0];

    if (!session) {
      test.skip(true, "种子数据里没有考试场次，跳过监考快照");
      return;
    }

    const feed = await client.get<{
      examSessionId?: number;
      serverTime?: string;
      candidates?: Array<{ userId?: number; status?: string }>;
    }>(ENDPOINTS.delivery.monitoring(session.id));

    expect(feed.examSessionId).toBe(session.id);
    expect(Number.isNaN(Date.parse(feed.serverTime ?? ""))).toBe(false);
    expect(Array.isArray(feed.candidates)).toBe(true);

    // 状态词表必须能映射到监考视图的语义；未识别的值会让页面显示「未开始」。
    const known = new Set([
      "not_started",
      "in_progress",
      "submitted",
      "auto_submitted",
      "force_submitted",
      "abandoned",
    ]);
    for (const candidate of feed.candidates ?? []) {
      expect(known.has(candidate.status ?? "")).toBe(true);
    }
  });

  test("修改本人密码：原密码校验、旧密码失效、新密码可登录", async () => {
    const suffix = Date.now().toString(36);
    const username = `e2epw${suffix}`;
    const oldPassword = `Old${suffix}Pass1`;
    const newPassword = `New${suffix}Pass2`;

    const roles = await client.get<Array<{ id: number; code: string }>>(ENDPOINTS.admin.roles);
    const studentRole = roles.find((role) => role.code === "student");
    expect(studentRole, "缺少学生角色").toBeTruthy();

    const created = await client.post<{ user?: { id?: number } }>("/users", {
      username,
      displayName: "联调改密用户",
      password: oldPassword,
      roleIds: [studentRole!.id],
    });
    expect(created.user?.id ?? 0).toBeGreaterThan(0);

    const signIn = async (password: string): Promise<Response> =>
      fetch(`${apiBase}${ENDPOINTS.auth.login}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

    const firstLogin = await signIn(oldPassword);
    expect(firstLogin.status).toBe(200);
    const firstBody = (await firstLogin.json()) as { accessToken?: string };

    await client.post(
      ENDPOINTS.auth.changePassword,
      { currentPassword: oldPassword, newPassword },
      {
        auth: false,
        headers: { Authorization: `Bearer ${firstBody.accessToken ?? ""}` },
      },
    );

    expect((await signIn(oldPassword)).status).toBe(422);
    expect((await signIn(newPassword)).status).toBe(200);

    // 顺带确认 ensureStudent 建出来的学生账号可用、权限码由服务端下发。
    expect(student.token).toBeTruthy();
    expect(student.permissions.length).toBeGreaterThan(0);
  });

  test("强制改密：标记期间只能改密，改密后换发的新令牌恢复通行", async () => {
    const suffix = Date.now().toString(36);
    const username = `e2eforce${suffix}`;
    const oldPassword = `Old${suffix}Pass1`;
    const newPassword = `New${suffix}Pass2`;

    const roles = await client.get<Array<{ id: number; code: string }>>(ENDPOINTS.admin.roles);
    const studentRole = roles.find((role) => role.code === "student");
    expect(studentRole, "缺少学生角色").toBeTruthy();

    const created = await client.post<{ user?: { id?: number } }>("/users", {
      username,
      displayName: "联调强制改密用户",
      password: oldPassword,
      roleIds: [studentRole!.id],
    });
    const userId = created.user?.id ?? 0;
    expect(userId).toBeGreaterThan(0);

    // 管理员重置密码并要求下次登录必须改密。
    await client.post(ENDPOINTS.admin.resetPassword(userId), {
      newPassword: oldPassword,
      mustChangeOnNextLogin: true,
    });

    const signIn = async (password: string): Promise<Response> =>
      fetch(`${apiBase}${ENDPOINTS.auth.login}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

    const loginResponse = await signIn(oldPassword);
    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as {
      accessToken?: string;
      user?: { mustChangePassword?: boolean };
    };
    expect(loginBody.user?.mustChangePassword).toBe(true);

    const token = loginBody.accessToken ?? "";
    const asUser = { auth: false, headers: { Authorization: `Bearer ${token}` } };

    // 标记期间：别的接口一律挡住。
    let blocked: number | undefined;
    try {
      await client.get(ENDPOINTS.catalog.tags, asUser);
    } catch (error) {
      blocked = error instanceof HttpError ? error.status : undefined;
    }
    expect(blocked, "必须改密期间应当是 403").toBe(403);

    // 改密：返回新令牌。
    const changed = await client.post<{ accessToken?: string }>(
      ENDPOINTS.auth.changePassword,
      { currentPassword: oldPassword, newPassword },
      asUser,
    );
    expect(changed.accessToken).toBeTruthy();
    expect(changed.accessToken).not.toBe(token);

    // 换上新令牌：恢复通行。
    const allowed = await client.get(ENDPOINTS.catalog.tags, {
      auth: false,
      headers: { Authorization: `Bearer ${changed.accessToken ?? ""}` },
    });
    expect(allowed).toBeTruthy();
  });

  test("学生可见的考试场次：按对象级范围返回", async () => {
    const sessions = await loadMyExamSessions(client);
    expect(Array.isArray(sessions)).toBe(true);
    for (const session of sessions) {
      expect(session.id).not.toBe("");
      expect(["scheduled", "in_progress", "closed", "cancelled"]).toContain(
        session.status,
      );
    }

    // 学生令牌下也能读到自己的场次（没有场次时是空数组，不是 403）。
    const asStudent = await client.get<{ items?: unknown[] }>(
      ENDPOINTS.delivery.examSessions,
      {
        query: { page: 1, size: 50 },
        auth: false,
        headers: { Authorization: `Bearer ${student.token}` },
      },
    );
    expect(Array.isArray(asStudent.items)).toBe(true);
  });
});
