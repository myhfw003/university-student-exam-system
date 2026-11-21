// ESLint 9 扁平配置（flat config）
// 覆盖整个工作区：shared / student / admin
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // 连后端模式的产物目录（dist-http 等）也是构建产物，不参与 lint。
      "**/dist-*/**",
      "**/coverage/**",
      "**/.twtest/**",
      "**/pnpm-lock.yaml",
    ],
  },

  // 基础 JS 规则
  js.configs.recommended,

  // TypeScript 规则（不开启类型感知，保持 lint 快速且不依赖 tsconfig 引用图）
  ...tseslint.configs.recommended,
  {
    rules: {
      // 下划线前缀表示「有意忽略」：函数参数用 argsIgnorePattern，其余用 varsIgnorePattern
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  // React 规则：hooks + fast refresh
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // 各包的具体环境
  {
    files: ["shared/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["student/**/*.{ts,tsx}", "admin/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["**/*.config.{js,ts}", "**/vite.config.ts", "**/vitest.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // 根级脚本（构建检查、渲染冒烟、静态服务器等）是 Node 程序。
  {
    files: ["scripts/**/*.{js,mjs}", "**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // 测试文件
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // 端到端用例（Playwright）：整个 e2e/ 目录都是用例代码，
  // setup/ 下是这些用例共用的夹具，与 *.spec.ts 同类。
  // 接口返回的 JSON 结构随接口而变，这里宽松标注，取值处再收窄。
  {
    files: ["e2e/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Prettier 放最后，关闭与其冲突的规则
  prettier,
);
