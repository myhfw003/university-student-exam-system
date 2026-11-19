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

/** 静态服务器端口（mock 模式产物）。 */
const PORT = Number(process.env.E2E_PORT ?? 4174);

/** 连后端那组浏览器用例的静态服务器端口（http 模式产物 + API 反代）。 */
const HTTP_PORT = Number(process.env.E2E_HTTP_PORT ?? 4175);

/** 是否跑真实后端那组用例。 */
const API_MODE = Boolean(process.env.E2E_API_BASE_URL);

/**
 * 是否跑「浏览器连真实后端」那组用例。
 *
 * 需要三样东西同时就位：真实后端（`E2E_API_BASE_URL`）、
 * 连后端模式的产物（`pnpm build:http`）、以及本机可达的后端地址。
 */
const HTTP_UI_MODE = Boolean(process.env.E2E_API_BASE_URL);

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
      // api 用例打真实后端、http 用例要连后端模式的产物，都不属于这组。
      testIgnore: [/.*\.api\.spec\.ts/, /.*\.http\.spec\.ts/],
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
    ...(HTTP_UI_MODE
      ? [
          {
            name: "ui-http",
            testMatch: /.*\.http\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${HTTP_PORT}` },
          },
        ]
      : []),
  ],
  // 静态服务器：mock 模式产物一份；连后端那组还要一份带 API 反代的。
  webServer: [
    ...(API_MODE
      ? []
      : [
          {
            command: `node scripts/serve-dist.mjs --port ${PORT}`,
            url: `http://127.0.0.1:${PORT}/`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            stdout: "ignore",
            stderr: "pipe",
          },
        ]),
    ...(HTTP_UI_MODE
      ? [
          {
            // 与 nginx 布局一致：`/api/` 反代到真实后端，前端因此用相对路径。
            command: `node scripts/serve-dist.mjs --port ${HTTP_PORT} --dist-suffix -http --api-target ${process.env.E2E_API_BASE_URL}`,
            url: `http://127.0.0.1:${HTTP_PORT}/`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            stdout: "ignore",
            stderr: "pipe",
          },
        ]
      : []),
  ],
});
