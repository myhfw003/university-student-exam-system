/* ==========================================================================
   前端构建产物校验
   --------------------------------------------------------------------------
   两个 SPA 打同一个 nginx，产物目录必须错开：

     学生端 → /assets/     （入口在 /）
     管理端 → /admin/assets/（入口在 /admin/）

   两者都用 `/` 打包时，产物会落进同一个 `/assets/` 目录，
   容器里管理端 index.html 会引用到学生端的同名文件 ——
   **HTTP 200，但 React 根本不挂载，整页空白**。
   curl 一下页面是发现不了这个问题的，只能校验产物引用。

   用法：node scripts/check-build-output.mjs
   ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 产物目录（与 vite 的 FRONTEND_BUILD_OUT_DIR 一致）。 */
const OUT_DIR = process.env.FRONTEND_BUILD_OUT_DIR ?? "dist";

/** 各 SPA 的挂载点与期望的产物前缀。 */
const TARGETS = [
  // mount 是该 SPA 在 nginx 里的挂载路径，prefix 是产物引用的 URL 前缀。
  { name: "学生端", dist: `student/${OUT_DIR}`, mount: "", prefix: "/assets/" },
  { name: "管理端", dist: `admin/${OUT_DIR}`, mount: "/admin", prefix: "/admin/assets/" },
];

const failures = [];

for (const target of TARGETS) {
  const distDir = join(root, target.dist);
  const indexPath = join(distDir, "index.html");

  if (!existsSync(indexPath)) {
    failures.push(`${target.name}：未找到 ${target.dist}/index.html，请先执行 pnpm build`);
    continue;
  }

  const html = readFileSync(indexPath, "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);

  if (refs.length === 0) {
    failures.push(`${target.name}：index.html 里没有找到任何 js/css 引用`);
    continue;
  }

  for (const ref of refs) {
    // 1. 引用必须落在期望前缀下。
    if (!ref.startsWith(target.prefix)) {
      failures.push(
        `${target.name}：引用 ${ref} 不在期望前缀 ${target.prefix} 下` +
          `（与另一个 SPA 的产物目录冲突会导致整页空白）`,
      );
      continue;
    }

    // 2. 引用的文件必须真实存在：去掉挂载点后按产物目录解析。
    const relative = target.mount ? ref.slice(target.mount.length) : ref;
    const filePath = join(distDir, relative.replace(/^\//, ""));
    if (!existsSync(filePath)) {
      failures.push(`${target.name}：引用 ${ref} 在产物目录中不存在`);
    }
  }

  console.log(
    `✓ ${target.name}：${refs.length} 个产物引用前缀正确且文件存在（${target.prefix}）`,
  );
}

if (failures.length > 0) {
  console.error("\n构建产物校验未通过：");
  for (const message of failures) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log("\n构建产物校验通过。");
