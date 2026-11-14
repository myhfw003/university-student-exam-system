/* ==========================================================================
   知行测评 · 端到端测试配置
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §12 的三条端到端流程：

     ① 登录 → 进入练习 → 作答 → 提交 → 看解析
     ② 教师组卷（规则抽题 → 发布）→ 阅卷 → 发布成绩 → 学生看到成绩
     ③ 考试中切屏 3 次 → 被强制交卷

   跑的是**生产产物**（student/dist 与 admin/dist），用与 nginx 布局一致的静态服务器托管
   （scripts/serve-dist.mjs），因此测的就是真正会部署上去的东西。

   先 `pnpm build` 再 `pnpm e2e`。
   ========================================================================== */

import { defineConfig, devices } from "@playwright/test";

/** 静态服务器端口。 */
const PORT = Number(process.env.E2E_PORT ?? 4174);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 演示数据存在内存里，多 worker 会各自拿到一份独立状态，串行跑更稳。
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node scripts/serve-dist.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
