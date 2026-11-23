/* ==========================================================================
   系统级设置（真实后端）
   --------------------------------------------------------------------------
   这一组用例守的是**全局开关**这条链路：

     读设置 → 改设置 → 再读确认落库 → 还原

   **为什么必须在真实后端上验**：设置存在库里的 `system_setting` 表，
   前端看不到也改不了。改完之后，错题本里「重做正确的题怎么处理」会跟着变——
   那是需求 FR-LRN-01 里「可配置为保留但标记已掌握」的那半句。

   设置是全局的，跑完必须还原成缺省档，别把后面的用例带歪。
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

/** 缺省档。 */
const DEFAULT_POLICY = "remove";
/** 另一档。 */
const KEEP_MASTERED = "keep_mastered";

test.describe("系统级设置（真实后端）", () => {
  test("管理员能读能改，改完立刻生效（跑完还原）", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    // 1. 读设置：没配置过就给缺省档。
    const before = await api(admin, "GET", "/api/v1/settings");
    expectOk(before, "读系统级设置");
    expect(before.json?.mistakeResolutionPolicy, "缺省档是移出错题本").toBe(DEFAULT_POLICY);

    // 2. 改设置：换成「保留但标记已掌握」。
    const update = await api(admin, "PUT", "/api/v1/settings", {
      mistakeResolutionPolicy: KEEP_MASTERED,
    });
    expectOk(update, "改系统级设置");
    expect(update.json?.mistakeResolutionPolicy, "改完返回的就是新值").toBe(KEEP_MASTERED);

    // 3. 再读一次：改动落库了，不用重启。
    const after = await api(admin, "GET", "/api/v1/settings");
    expectOk(after, "再读系统级设置");
    expect(after.json?.mistakeResolutionPolicy, "改动要落库").toBe(KEEP_MASTERED);

    // 4. 还原：别把库留在改过的状态。
    const restore = await api(admin, "PUT", "/api/v1/settings", {
      mistakeResolutionPolicy: DEFAULT_POLICY,
    });
    expectOk(restore, "还原系统级设置");

    const restored = await api(admin, "GET", "/api/v1/settings");
    expect(restored.json?.mistakeResolutionPolicy, "还原后回到缺省档").toBe(DEFAULT_POLICY);
  });

  test("原始密码：能配能清，响应里不带密码", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    const set = await api(admin, "PUT", "/api/v1/settings/original-password", {
      password: "OrigPass123",
    });
    expectOk(set, "设置原始密码");
    expect(set.json?.originalPasswordConfigured, "配完要显示成已配置").toBe(true);
    // 只写不回显：响应里既没有密码字段，也不含明文。
    expect(set.raw, "响应里不能带密码").not.toContain("OrigPass123");

    const get = await api(admin, "GET", "/api/v1/settings");
    expectOk(get, "读系统级设置");
    expect(get.json?.originalPasswordConfigured, "读回来是已配置").toBe(true);

    // 还原：别把全局设置留在改过的状态。
    const clear = await api(admin, "DELETE", "/api/v1/settings/original-password");
    expectOk(clear, "清除原始密码");
    expect(clear.json?.originalPasswordConfigured, "清完要显示成没配").toBe(false);
  });

  test("原始密码太弱被挡下，没权限的人配不了", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    const weak = await api(admin, "PUT", "/api/v1/settings/original-password", {
      password: "short",
    });
    expect(weak.status, "太弱的原始密码应当是 400").toBe(400);

    const student = await ensureStudent(apiRoot, admin);
    const session = await login(apiRoot, student.username, student.password);
    const write = await api(session, "PUT", "/api/v1/settings/original-password", {
      password: "OrigPass123",
    });
    expect(write.status, "学生没有 system:configure，应当配不了").toBe(403);
  });

  test("没有权限的人读不到也改不了", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);
    const student = await ensureStudent(apiRoot, admin);
    const session = await login(apiRoot, student.username, student.password);

    const read = await api(session, "GET", "/api/v1/settings");
    expect(read.status, "学生没有 system:configure，应当读不到").toBe(403);

    const write = await api(session, "PUT", "/api/v1/settings", {
      mistakeResolutionPolicy: KEEP_MASTERED,
    });
    expect(write.status, "学生没有 system:configure，应当改不了").toBe(403);
  });

  test("非法取值被挡下，原值不变", async () => {
    const admin = await login(apiRoot, adminUsername, adminPassword);

    const bad = await api(admin, "PUT", "/api/v1/settings", {
      mistakeResolutionPolicy: "乱写",
    });
    expect(bad.status, "非法取值应当是 400").toBe(400);
    expect(bad.raw, "拒绝的原因要说清楚").toContain("不合法");

    const after = await api(admin, "GET", "/api/v1/settings");
    expect(after.json?.mistakeResolutionPolicy, "挡下之后原值不变").toBe(DEFAULT_POLICY);
  });
});
