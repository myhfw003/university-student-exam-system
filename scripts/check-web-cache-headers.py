#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对前端 nginx 的**缓存策略**：入口页不缓存、哈希产物长期缓存且不回退。

前端产物是**带内容哈希**的文件名（`index-a1b2c3.js`）：内容变了文件名就变。
这条性质决定了缓存策略必须是两头相反的：

- **入口 HTML（`index.html`）绝不能缓存**：它里面写死了产物文件名。
  浏览器手里留着上一版的入口页，就会去取**已经不在的**旧文件名。
- **哈希产物可以长期缓存（`immutable`）**：名字变了就是内容变了，
  旧名字再被请求时应当干脆 404，而不是回退成 HTML。

**两头配错的后果都是整页白屏**，而且单测与 e2e 都发现不了：
2026-11-27 发新前端产物时，老师的浏览器里还存着 11-26 的
`/admin/index.html`，它引用的旧 chunk 已经不在了，而 nginx 的
SPA 回退把那个请求回退成了 `index.html` —— 浏览器按 JS 去执行 HTML，
报 MIME 错误，React 根本不挂载。

CI 里那条「渲染冒烟检查」抓不到这个：它自起的静态服务器
（`frontend/scripts/serve-dist.mjs`）**不发任何缓存头**，
且它明确不复刻 nginx 的回退行为。所以要有这道守卫。

用法：
    python3 scripts/check-web-cache-headers.py
退出码非 0 表示缓存策略配错了。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NGINX_CONF = ROOT / "frontend/nginx.conf"

# 入口页：必须每次回源校验（no-cache），不能缓存。
ENTRY_PAGES = ["/index.html", "/admin/index.html", "/portal/index.html"]

# 哈希产物目录：可以长期缓存，且**不许**回退成 HTML（缺失就 404）。
ASSET_PREFIXES = ["/assets/", "/admin/assets/"]


def parse_locations(text):
    """把 nginx.conf 里的 location 块解析成 {选择器: 块正文}。"""
    locations = {}
    # location 后面可能是 `= /path`、`/path`、`/path/` 或带 `~` 的正则
    for match in re.finditer(r"location\s+(=\s*[^\s{]+|~[^\s{]+|[^\s{]+)\s*\{", text):
        # 归一化：`= /index.html` → `/index.html`（去掉精确匹配标记与空格）
        selector = re.sub(r"^=\s*", "", match.group(1).strip())
        selector = re.sub(r"\s+", "", selector)
        depth = 1
        index = match.end()
        while index < len(text) and depth > 0:
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
            index += 1
        body = text[match.end() : index - 1]
        locations[selector] = body
    return locations


def main():
    text = NGINX_CONF.read_text(encoding="utf-8")
    locations = parse_locations(text)
    problems = []

    # ---- 入口页：必须有 no-cache ----
    for page in ENTRY_PAGES:
        body = locations.get(page)
        if body is None:
            problems.append(f"没有为入口页 {page} 单独配 location")
            continue
        if "Cache-Control" not in body or "no-cache" not in body:
            problems.append(
                f"入口页 {page} 没有设 Cache-Control: no-cache"
                "（浏览器会留着旧入口页，去取已经不存在的旧产物文件名）"
            )

    # ---- 哈希产物：必须长期缓存，且缺失时 404 而不是回退成 HTML ----
    for prefix in ASSET_PREFIXES:
        body = locations.get(prefix)
        if body is None:
            problems.append(f"没有为产物目录 {prefix} 单独配 location")
            continue
        if "immutable" not in body:
            problems.append(
                f"产物目录 {prefix} 没有设 Cache-Control: public, immutable"
                "（文件名带内容哈希，可以长期缓存）"
            )
        if "try_files" not in body or "=404" not in body:
            problems.append(
                f"产物目录 {prefix} 没有 `try_files $uri =404`"
                "（缺失的旧文件名会落进 SPA 回退，拿到一份 HTML——"
                "浏览器按 JS 执行 HTML 直接报 MIME 错误、整页白屏）"
            )

    # ---- 入口页不能落在产物目录的 location 里 ----
    for page in ENTRY_PAGES:
        for prefix in ASSET_PREFIXES:
            if page.startswith(prefix):
                problems.append(f"入口页 {page} 落进了产物目录 {prefix} 的 location")

    if problems:
        print("前端 nginx 的缓存策略配错了：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：入口 HTML 单独开 `location = <路径>` 并加 "
            "`add_header Cache-Control \"no-cache\";`；"
            "产物目录单独开 `location <前缀>/` 并加 "
            "`expires 7d; add_header Cache-Control \"public, immutable\";` "
            "与 `try_files $uri =404;`（缺失就 404，别回退成 HTML）。"
        )
        return 1

    print(
        "前端 nginx 的缓存策略正确："
        f"入口页 {len(ENTRY_PAGES)} 个不缓存，"
        f"产物目录 {len(ASSET_PREFIXES)} 个长期缓存且缺失即 404。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
