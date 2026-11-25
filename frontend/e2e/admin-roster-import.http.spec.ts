/* ==========================================================================
   人员名单批量导入（真实后端）
   --------------------------------------------------------------------------
   为什么必须在真实后端上验：2026-11-25 的真缺陷就在这条链路上——
   管理端提示教师填「初始密码」列，后端的列名词表里没有这一列，
   整列被**静默丢弃**，账号全部落到系统设定的原始密码上，没有任何提示。
   前端 mock 的解析器认这一列，所以 mock 模式的用例全绿。

   这里验两件事：
     ① 导入成功（这一列被认出来了，没有被静默丢弃）；
     ② 名单里给的密码就是这个账号的登录密码：能登录，且不强制改密
     （教师逐个给定的密码不是全系统共用的那个值）。

   **不动全局的「系统原始密码」**：那是全系统共用的设置，
   这里配了/清掉会与 `system-settings.http.spec.ts` 互相干扰
   （那条用例断言「没配时显示未配置」）。「重置密码回系统原始密码、
   而不是回名单里给的那个」与「名单里没给密码时用系统原始密码且须改密」
   由后端功能测试
   `名单导入_初始密码列就是该账号的登录密码`、
   `名单导入_没给初始密码时用系统原始密码且首次登录须改密`、
   `重置密码_回到系统原始密码而不是名单给的注册密码` 覆盖
   （它们在独立库里跑，互不干扰）。
   ========================================================================== */

import { expect, test, type Page } from "@playwright/test";
import { adminPassword, adminUsername, apiRoot, login } from "./setup/api";

/** 名单里给这个账号的密码——它就是这个账号的登录密码。 */
const INITIAL_PASSWORD = "Init9pass";

/** 账号名带时间戳：重复跑不会撞上上一轮留下的账号。 */
const ACCOUNT = `e2e-roster-${String(Date.now()).slice(-9)}`;

/** 在管理端浏览器里登录。 */
async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.fill("#login-account", adminUsername);
  await page.fill("#login-password", adminPassword);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
}

/** 用指定口令登录。状态码本身就是断言对象，这里不抛错。 */
function loginRequest(username: string, password: string): Promise<Response> {
  return fetch(`${apiRoot}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

test.describe("名单批量导入（真实后端）", () => {
  test("「初始密码」列落到账号上，就是它的登录密码", async ({ page }) => {
    await login(apiRoot, adminUsername, adminPassword);
    await loginAdmin(page);

    const csv = [
      "账号,姓名,院系,专业,班级,邮箱,角色,初始密码",
      `${ACCOUNT},名单同学,计算机学院,软件工程,软工2301,${ACCOUNT}@example.edu,,${INITIAL_PASSWORD}`,
    ].join("\n");

    await page.goto("/admin/users");
    await page.getByRole("button", { name: "批量导入" }).click();
    const dialog = page.getByRole("dialog");
    await page.locator("#roster-file").setInputFiles({
      name: "名单.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await page.getByRole("button", { name: "确认导入" }).click();

    // 这一列被认出来了：导入成功，没有被静默丢弃。
    // （若后端又把它丢了，且环境里没配系统原始密码，这一行会整行失败。）
    await expect(dialog.getByText(/导入完成：成功 1 行/)).toBeVisible();

    // 名单里给的密码就是这个账号的登录密码：它能登录，且不强制改密。
    const given = await loginRequest(ACCOUNT, INITIAL_PASSWORD);
    expect(given.status).toBe(200);
    const body = await given.json();
    expect(body.user.mustChangePassword).toBe(false);
  });
});
