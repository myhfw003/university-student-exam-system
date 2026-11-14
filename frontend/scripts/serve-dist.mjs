/* ==========================================================================
   生产产物静态服务器
   --------------------------------------------------------------------------
   与 nginx 布局一致：

     /            → 学生端 dist
     /admin/      → 管理端 dist
     其余路径      → 对应 SPA 的 index.html（前端路由回退）

   **不用 vite preview**：它的 SPA 回退会把 /admin/assets/*.js 也回退成
   index.html（Content-Type: text/html），产物路径根本测不到。
   自己起服务器才能复现真实的部署布局。

   渲染冒烟检查（scripts/smoke-render.mjs）与端到端测试（playwright.config.ts）
   共用这一份实现，避免两处各写一遍布局规则。
   ========================================================================== */

import { existsSync } from "node:fs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** 起静态服务器，返回 { studentBase, adminBase, close }。 */

/** 起静态服务器，返回 { studentBase, adminBase, origin, close }。 */
export async function serveDist(port = 0) {
  const { createServer } = await import("node:http");
  const { statSync, readFileSync } = await import("node:fs");
  const { dirname, extname, join, normalize } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const wsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const studentDist = join(wsRoot, "student", "dist");
  const adminDist = join(wsRoot, "admin", "dist");

  for (const [name, dir] of [["学生端", studentDist], ["管理端", adminDist]]) {
    if (!existsSync(join(dir, "index.html"))) {
      throw new Error(`${name}产物不存在：${dir}，请先执行 pnpm build`);
    }
  }

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);

    if (urlPath === "/admin") {
      res.writeHead(301, { Location: "/admin/" });
      res.end();
      return;
    }

    const isAdmin = urlPath.startsWith("/admin/");
    const distRoot = isAdmin ? adminDist : studentDist;
    const relative = isAdmin ? urlPath.slice("/admin".length) : urlPath;

    // 归一化并阻断路径穿越
    const safe = normalize(relative).replace(/^(\.\.[/])+/, "");
    const filePath = join(distRoot, safe);

    let body;
    let type;
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      body = readFileSync(filePath);
      type = MIME[extname(filePath)] ?? "application/octet-stream";
    } else {
      // SPA 回退
      body = readFileSync(join(distRoot, "index.html"));
      type = MIME[".html"];
    }

    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  });

  const actualPort = await new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
  const origin = `http://127.0.0.1:${actualPort}`;

  return {
    studentBase: `${origin}/`,
    adminBase: `${origin}/admin/`,
    close: () => server.close(),
  };
}

/* ------------------------------------------------------------------ CLI */

/** 直接运行时当静态服务器用：node scripts/serve-dist.mjs --port 4174 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--port");
  const port = index >= 0 ? Number(process.argv[index + 1]) || 4174 : 4174;
  const server = await serveDist(port);
  console.log(`学生端 ${server.studentBase}`);
  console.log(`管理端 ${server.adminBase}`);
}
