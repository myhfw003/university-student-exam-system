import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@exam/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // 产物目录可换：`FRONTEND_BUILD_OUT_DIR=dist-http` 出一份连后端的产物，
    // 与 mock 模式的产物并存（端到端用例会分别托管）。
    outDir: process.env.FRONTEND_BUILD_OUT_DIR ?? "dist",
    // 性能预算：student 首屏 JS ≤ 400 KB gzip（docs/design/06-frontend.md §10）
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // CSS 用稳定文件名：入口门户页是静态 HTML，引用 /assets/app.css。
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? "assets/app.css"
            : "assets/[name]-[hash][extname]",
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
});
