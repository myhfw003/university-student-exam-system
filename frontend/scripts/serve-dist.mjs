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

/**
 * 把请求转发给后端。
 *
 * 与 nginx 的 `location /api/` 反代同义：路径原样带过去，
 * `Set-Cookie`（刷新令牌的 HttpOnly Cookie）等响应头原样带回。
 */
function proxyTo(request, req, res, target) {
  const url = new URL(target);
  const upstream = request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: url.host },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );

  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("后端代理失败");
  });

  req.pipe(upstream);
}

/**
 * 起静态服务器，返回 { studentBase, adminBase, origin, close }。
 *
 * @param port 端口，0 表示随机。
 * @param options
 * - `apiTarget`：反代目标（如 `http://127.0.0.1:8081`）。给了就把 `/api/*`
 *   转发过去——与 nginx 的 `location /api/` 同义，前端因此可以用相对路径
 *   `/api/v1`，不用处理跨域。
 * - `distSuffix`：产物目录后缀（`-http` → `dist-http`），用于把
 *   「mock 模式产物」与「连后端模式产物」分开。
 */
export async function serveDist(port = 0, options = {}) {
  const { apiTarget, distSuffix = "" } = options;
  const { createServer, request } = await import("node:http");
  const { statSync, readFileSync } = await import("node:fs");
  const { dirname, extname, join, normalize } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const wsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const studentDist = join(wsRoot, "student", `dist${distSuffix}`);
  const adminDist = join(wsRoot, "admin", `dist${distSuffix}`);

  for (const [name, dir] of [["学生端", studentDist], ["管理端", adminDist]]) {
    if (!existsSync(join(dir, "index.html"))) {
      throw new Error(
        `${name}产物不存在：${dir}，请先执行 ${distSuffix ? "pnpm build:http" : "pnpm build"}`,
      );
    }
  }

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);

    // API 反代：与 nginx 的 `location /api/` 同义——同源部署，前端用相对路径。
    if (apiTarget && urlPath.startsWith("/api/")) {
      proxyTo(request, req, res, apiTarget);
      return;
    }

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
  const apiIndex = process.argv.indexOf("--api-target");
  const apiTarget = apiIndex >= 0 ? process.argv[apiIndex + 1] : undefined;
  const suffixIndex = process.argv.indexOf("--dist-suffix");
  const distSuffix = suffixIndex >= 0 ? (process.argv[suffixIndex + 1] ?? "") : "";
  const server = await serveDist(port, { apiTarget, distSuffix });
  console.log(`学生端 ${server.studentBase}`);
  console.log(`管理端 ${server.adminBase}`);
  if (apiTarget) console.log(`API 反代 → ${apiTarget}`);
}
