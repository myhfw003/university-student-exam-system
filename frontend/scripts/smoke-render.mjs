/* ==========================================================================
   前端渲染冒烟检查
   --------------------------------------------------------------------------
   **为什么需要它**：样式漏移植、产物路径撞车这类问题，typecheck、lint、
   单元测试全都发现不了 —— 它们不碰真实浏览器。管理端曾因产物目录与学生端
   撞车而整页空白，curl 返回 200，只有真实渲染才暴露。

   本脚本用 headless Chromium 逐路由检查：

     1. 页面是否真的渲染出内容（防白屏）
     2. 是否出现控制台错误 / 未捕获异常
     3. 是否有失败的资源请求（防 404 导致的局部失效）
     4. 关键文案是否出现（防路由串页、守卫失效）

   **零依赖**：直接用 CDP（Chrome DevTools Protocol）驱动，
   Node 22+ 自带 WebSocket，不需要装 playwright。

   用法：
     node scripts/smoke-render.mjs
     node scripts/smoke-render.mjs --student http://localhost:5173 --admin http://localhost:5174
     node scripts/smoke-render.mjs --screenshot-dir /tmp/shots
     node scripts/smoke-render.mjs --require-browser     # 找不到浏览器即失败（CI 用）

   浏览器查找顺序：
     1. 环境变量 CHROME_PATH
     2. Playwright 缓存目录（~/.cache/ms-playwright/chromium-*）
     3. 系统常见路径（chromium / google-chrome）
   ========================================================================== */

import { spawn } from "node:child_process";
import { serveDist } from "./serve-dist.mjs";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const args = {
    student: "",
    admin: "",
    screenshotDir: "",
    requireBrowser: false,
    serveDist: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--student") args.student = argv[++i] ?? "";
    else if (key === "--admin") args.admin = argv[++i] ?? "";
    else if (key === "--screenshot-dir") args.screenshotDir = argv[++i] ?? "";
    else if (key === "--require-browser") args.requireBrowser = true;
    else if (key === "--serve-dist") args.serveDist = true;
  }
  if (!args.student) args.student = process.env.SMOKE_STUDENT_URL ?? "http://localhost:5173";
  if (!args.admin) args.admin = process.env.SMOKE_ADMIN_URL ?? "http://localhost:5174";
  return args;
}

const args = parseArgs(process.argv.slice(2));

/* ------------------------------------------------------- 待检查的路由表 */

/** 每项：路径、必须出现的文案、正文最小字数（低于此值视为白屏）。 */
const STUDENT_ROUTES = [
  { path: "/", marker: "林知远", min: 300 },
  { path: "/practice", marker: "练习中心", min: 200 },
  { path: "/practice/prac-net-tp", marker: "传输层", min: 200 },
  { path: "/exams", marker: "计算机网络期中考试", min: 300 },
  { path: "/exams/exam-net-mid", marker: "答题卡", min: 300 },
  { path: "/exams/exam-net-mid/report", marker: "暂未参加该考试", min: 100 },
  { path: "/reports", marker: "成绩", min: 100 },
  { path: "/mistakes", marker: "错题", min: 200 },
  { path: "/profile", marker: "个人中心", min: 200 },
  { path: "/profile/abilities", marker: "能力画像", min: 200 },
];

const ADMIN_ROUTES = [
  { path: "/", marker: "待办工作台", min: 300 },
  { path: "/tags", marker: "标签是本系统的组织轴", min: 300 },
  { path: "/banks", marker: "题库清单", min: 300 },
  { path: "/banks/bank-calc-basic", marker: "题目", min: 300 },
  { path: "/papers", marker: "发布校验", min: 300 },
  { path: "/papers/exam-net-mid", marker: "基本信息", min: 300 },
  { path: "/practices", marker: "开放单清单", min: 300 },
  { path: "/roles", marker: "角色清单", min: 300 },
  { path: "/review", marker: "卷宗队列", min: 300 },
  { path: "/analytics", marker: "逐题正确率", min: 300 },
  { path: "/exam-sessions", marker: "场次清单", min: 300 },
  { path: "/exam-sessions/sess-net-mid", marker: "防作弊策略", min: 300 },
  { path: "/monitoring", marker: "可监考场次", min: 200 },
  { path: "/monitoring/sess-net-mid", marker: "考生状态", min: 300 },
  { path: "/users", marker: "账号清单", min: 300 },
  { path: "/audit-logs", marker: "审计日志", min: 300 },
  { path: "/settings", marker: "系统设置", min: 300 },
];

/* --------------------------------------------------------- 浏览器查找 */

/** 找到可用的 Chromium 可执行文件；找不到返回 null。 */
function findChromium() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // Playwright 缓存目录
  const cacheRoot = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cacheRoot)) {
    const candidates = [];
    for (const dir of readdirSync(cacheRoot)) {
      if (!dir.startsWith("chromium")) continue;
      candidates.push(
        join(cacheRoot, dir, "chrome-linux64", "chrome"),
        join(cacheRoot, dir, "chrome-linux", "chrome"),
        join(cacheRoot, dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      );
    }
    const hit = candidates.find((p) => existsSync(p));
    if (hit) return hit;
  }

  // 系统常见路径
  const systemPaths = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ];
  return systemPaths.find((p) => existsSync(p)) ?? null;
}

/* ------------------------------------------------------------- CDP 驱动 */

const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--no-first-run",
  "--hide-scrollbars",
  "--window-size=1440,900",
];

/** 启动 Chromium，返回 { wsUrl, kill }。 */
async function launchChromium(binary) {
  const profile = join(tmpdir(), `exam-smoke-${Date.now()}`);
  const child = spawn(
    binary,
    [...CHROME_FLAGS, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Chromium 启动超时（30s）")), 30_000);
    child.stderr.on("data", (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium 退出，代码 ${code}`));
    });
  });

  return {
    wsUrl,
    kill: () => child.kill("SIGKILL"),
  };
}

/** 一个页面 target 的 CDP 客户端。 */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      const handlers = this.listeners.get(msg.method);
      if (handlers) for (const handler of handlers) handler(msg.params);
    };
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30_000);
    });
  }
}

/** 打开一个新页面 target 并返回其 CDP 客户端。 */
async function openPage(browserWsUrl) {
  const base = browserWsUrl.replace(/^ws:\/\//, "http://").replace(/\/devtools\/browser\/.*$/, "");
  const res = await fetch(`${base}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("无法连接 CDP 页面"));
  });
  return new Page(ws);
}

/* ------------------------------------------------------------- 单页检查 */

/** 导航并等待渲染完成，返回诊断结果。 */
async function checkRoute(page, url, route) {
  const consoleErrors = [];
  const exceptions = [];
  const failedRequests = [];

  const onConsole = (p) => {
    if (p.type === "error") {
      consoleErrors.push(
        p.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300),
      );
    }
  };
  const onException = (p) => {
    exceptions.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "未知异常");
  };
  const onFailed = (p) => {
    if (!p.canceled) failedRequests.push(`${p.type ?? "资源"} 加载失败`);
  };
  const onResponse = (p) => {
    if (!p.response) return;
    const status = p.response.status;
    if (status < 400) return;
    // favicon 由浏览器自动请求，原型也没有提供，不计为失败
    if (p.response.url.endsWith("/favicon.ico")) return;
    // 开发服务器不反代后端，/api/ 的 404 属预期；
    // 但 5xx 与其它状态码仍要报出来。
    if (status === 404 && p.response.url.includes("/api/")) return;
    failedRequests.push(`${status} ${p.response.url}`);
  };

  page.on("Runtime.consoleAPICalled", onConsole);
  page.on("Runtime.exceptionThrown", onException);
  page.on("Network.loadingFailed", onFailed);
  page.on("Network.responseReceived", onResponse);

  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url });

  // 等页面渲染出正文：轮询 body.innerText。
  //
  // **等的是关键文案，不是长度**：外壳（顶栏 + 侧栏）本身就有近百字，
  // 只按长度判断会在内容渲染出来之前就提前退出，把正常页面判成失败。
  let text = "";
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const res = await page.send("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : ''",
      returnByValue: true,
    });
    text = res?.result?.value ?? "";
    if (text.includes(route.marker) && text.trim().length >= route.min) break;
  }

  const problems = [];
  const trimmed = text.trim();

  if (trimmed.length < route.min) {
    problems.push(`正文过短（${trimmed.length} < ${route.min}），疑似白屏`);
  }
  if (!trimmed.includes(route.marker)) {
    problems.push(`未出现关键文案「${route.marker}」`);
  }
  if (exceptions.length > 0) {
    problems.push(`未捕获异常：${exceptions[0]}`);
  }
  if (consoleErrors.length > 0) {
    problems.push(`控制台错误：${consoleErrors[0]}`);
  }
  if (failedRequests.length > 0) {
    problems.push(`资源请求失败：${failedRequests[0]}`);
  }

  let shotPath = "";
  if (args.screenshotDir) {
    mkdirSync(args.screenshotDir, { recursive: true });
    const slug = route.path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "index";
    shotPath = join(args.screenshotDir, `${slug}.png`);
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  }

  return { problems, textLength: trimmed.length, shotPath };
}


/* ------------------------------------------------------------------ 主流程 */

async function main() {
  let server = null;
  if (args.serveDist) {
    server = await serveDist();
    args.student = server.studentBase;
    args.admin = server.adminBase;
  }

  const binary = findChromium();
  if (!binary) {
    const msg = [
      "未找到可用的 Chromium，已跳过渲染冒烟检查。",
      "  安装方式一：npx --yes playwright install chromium",
      "  安装方式二：apt-get install -y chromium",
      "  或用 CHROME_PATH 指定已有的可执行文件。",
    ].join("\n");
    if (args.requireBrowser || process.env.CI) {
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
    console.log(`⚠ ${msg}`);
    process.exit(0);
  }

  console.log(`浏览器：${binary}`);
  console.log(`学生端：${args.student}`);
  console.log(`管理端：${args.admin}\n`);

  const browser = await launchChromium(binary);
  let failed = 0;
  let checked = 0;

  try {
    for (const [label, base, routes] of [
      ["学生端", args.student, STUDENT_ROUTES],
      ["管理端", args.admin, ADMIN_ROUTES],
    ]) {
      const page = await openPage(browser.wsUrl);
      for (const route of routes) {
        const url = base.replace(/\/$/, "") + route.path;
        let result;
        try {
          result = await checkRoute(page, url, route);
        } catch (error) {
          result = { problems: [`检查过程失败：${error.message}`], textLength: 0, shotPath: "" };
        }
        checked += 1;
        if (result.problems.length === 0) {
          console.log(`  ✓ ${label} ${route.path}（${result.textLength} 字）`);
        } else {
          failed += 1;
          console.log(`  ✗ ${label} ${route.path}`);
          for (const problem of result.problems) console.log(`      · ${problem}`);
        }
      }
    }
  } finally {
    browser.kill();
    if (server) server.close();
  }

  console.log("");
  if (failed > 0) {
    console.error(`✗ 渲染冒烟检查未通过：${failed} / ${checked} 个路由有问题`);
    process.exit(1);
  }
  console.log(`✓ 渲染冒烟检查通过：${checked} 个路由全部正常渲染`);
}

main().catch((error) => {
  console.error(`✗ 渲染冒烟检查异常：${error.stack ?? error.message}`);
  process.exit(1);
});
