import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  /**
   * 构建产物挂在 `/admin/` 下（nginx 用 `location /admin/` 独立托管）。
   *
   * **必须与学生端错开**：两个 SPA 都用 `/` 打包时，产物会落到同一个
   * `/assets/` 目录，容器里管理端 index.html 会引用到学生端的同名文件，
   * 表现为页面 200 但 React 不挂载（整页空白）。
   *
   * 开发时保持 `/`，dev server 直接跑在根路径。
   */
  base: command === "build" ? "/admin/" : "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@exam/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    // 产物目录可换：`FRONTEND_BUILD_OUT_DIR=dist-http` 出一份连后端的产物，
    // 与 mock 模式的产物并存（端到端用例会分别托管）。
    outDir: process.env.FRONTEND_BUILD_OUT_DIR ?? "dist",
    // 性能预算：admin 首屏 JS ≤ 700 KB gzip（docs/design/06-frontend.md §10）
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
}));
