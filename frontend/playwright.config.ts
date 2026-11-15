/* ==========================================================================
   知行测评 · 端到端测试配置
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §12 的端到端流程与 T-P9-01。

   两组用例，两个项目：

   - **ui**：跑生产产物（student/dist 与 admin/dist），用与 nginx 布局一致的
     静态服务器托管（scripts/serve-dist.mjs），测的就是真正会部署上去的东西。
   - **api**：打**真实后端**（API + PostgreSQL + Redis），做接口全景巡检与
     越权断言。越权与错误结构这类问题在 mock 模式下验不出来——mock 根本没有
     鉴权层。设了 E2E_API_BASE_URL 才启用这个项目。

   先 `pnpm build` 再 `pnpm e2e`。
   ========================================================================== */

import { defineConfig, devices } from "@playwright/test";

/** 静态服务器端口。 */
const PORT = Number(process.env.E2E_PORT ?? 4174);

/** 是否跑真实后端那组用例。 */
const API_MODE = Boolean(process.env.E2E_API_BASE_URL);

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
    // 失败时保留现场：trace 记录每一步，截图记录当时长什么样。
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "ui",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /.*\.api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    ...(API_MODE
      ? [
          {
            name: "api",
            testMatch: /.*\.api\.spec\.ts/,
          },
        ]
      : []),
  ],
  // 跑真实后端那组用例时不需要前端产物，也不启静态服务器。
  ...(API_MODE
    ? {}
    : {
        webServer: {
          command: `node scripts/serve-dist.mjs --port ${PORT}`,
          url: `http://127.0.0.1:${PORT}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: "ignore",
          stderr: "pipe",
        },
      }),
});
