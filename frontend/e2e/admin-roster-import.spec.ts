/* ==========================================================================
   端到端：人员名单批量导入（FR-IAM-05）
   --------------------------------------------------------------------------
   走管理端「用户 → 批量导入」的真实路径：

     ① 上传 CSV → 逐行校验，错误行标红跳过
     ② 确认导入 → 新建账号 + 自动创建组织维度标签
     ③ 失败明细回显（新账号的登录密码只说明、不回显）
   ========================================================================== */

import { expect, test } from "@playwright/test";

/** 一份名单 CSV：1 行正常、1 行缺姓名、1 行文件内重复、1 行弱密码。 */
const ROSTER_CSV = [
  "账号,姓名,院系,专业,班级,邮箱,角色,初始密码",
  "2023999001,测试同学,计算机学院,软件工程,软件工程 2023 级 1 班,t1@example.edu,,",
  "2023999002,,计算机学院,软件工程,软件工程 2023 级 1 班,t2@example.edu,,",
  "2023999001,重复同学,计算机学院,软件工程,软件工程 2023 级 1 班,t3@example.edu,,",
  "2023999003,弱密码同学,计算机学院,软件工程,软件工程 2023 级 1 班,t4@example.edu,,123",
].join("\n");

test("管理端：人员名单批量导入，逐行校验并写入账号", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();

  // 打开导入弹窗。
  await page.getByRole("button", { name: "批量导入" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // 上传 CSV。
  await page.locator("#roster-file").setInputFiles({
    name: "名单.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(ROSTER_CSV, "utf-8"),
  });

  // 预览表格出现 4 行数据，其中 3 行有问题（缺姓名 / 文件内重复 / 密码过弱）。
  const rows = page.locator("dialog table tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("新建");
  await expect(rows.nth(1)).toContainText("缺少姓名");
  await expect(rows.nth(2)).toContainText("账号在本文件中重复");
  await expect(rows.nth(3)).toContainText("初始密码");

  // 确认导入：1 行成功，3 行失败。断言限定在弹窗内（同名文案也会出现在 Toast 里）。
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(dialog.getByText(/导入完成：成功 1 行，失败 3 行/)).toBeVisible();
  await expect(dialog.getByText(/第 3 行/)).toBeVisible();
  // 新账号的登录密码：名单「初始密码」列填了的用它，没填的用系统设定的原始密码。
  // 只说明，不回显密码。断言要够具体：CSV 列定义那段也提到「原始密码」，
  // 只写 /系统设定的原始密码/ 会命中两处。
  await expect(dialog.getByText(/新账号的登录密码/)).toBeVisible();

  // 关闭弹窗后，新账号已在清单里。
  await dialog.locator("button.btn-secondary", { hasText: "关闭" }).click();
  await expect(page.getByText("2023999001", { exact: true })).toBeVisible();
});
