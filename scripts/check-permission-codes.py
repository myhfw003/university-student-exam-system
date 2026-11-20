#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对权限点词表：后端的与前端登记的是不是同一套。

权限码是**前后端共享的词表**：

- 后端 `PermissionCatalog` 拿它判定每个请求能不能过；
- 前端 `PermissionPoint` 拿它判路由守卫、按钮显隐，
  管理端的角色权限矩阵还要按权限码回显中文名。

写错一个码的后果是**静默**的：前端多一个码，后端不认，路由守卫放行
但接口一律 403；前端少一个码，后端认了，前端却把入口藏起来。
这两种错都不会让任何测试变红。

中文名也要一致：管理端的权限矩阵按服务端的中文名显示，
mock 模式用的是前端词表里的中文名，两边不一样时同一个权限点
在两种模式下显示成两个名字。

用法：
    python3 scripts/check-permission-codes.py
退出码非 0 表示两边对不上。

**不核对角色 → 权限的映射**：那份映射在后端是**库里的数据**
（`role_permission` 表，管理端可以改），不是写死的词表。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_CATALOG = ROOT / "backend/src/Exam.Domain/Identity/PermissionCatalog.cs"
FRONTEND_PERMISSIONS = ROOT / "frontend/shared/src/auth/permissions.ts"


def backend_codes():
    """后端的权限码 → 中文名。"""
    text = BACKEND_CATALOG.read_text(encoding="utf-8")
    codes = dict(re.findall(r'public const string (\w+) = "([^"]+)";', text))

    names_block = text.split("DisplayNames", 1)[1]
    names = dict(re.findall(r'\[(\w+)\]\s*=\s*"([^"]+)"', names_block))
    display = {codes[const]: label for const, label in names.items() if const in codes}

    # 全部权限码（All 列表里逐个列出来的那些）。
    all_block = text.split("public static IReadOnlyList<string> All", 1)[1]
    listed = [codes[name] for name in re.findall(r"\b([A-Z][A-Za-z]+)\b", all_block) if name in codes]
    return {code: display.get(code, "") for code in listed}


def frontend_codes():
    """前端的权限码 → 中文名。"""
    text = FRONTEND_PERMISSIONS.read_text(encoding="utf-8")

    union_block = text.split("export type PermissionPoint =", 1)[1].split(";", 1)[0]
    union = re.findall(r'"([a-z-]+:[a-z-]+)"', union_block)

    names_block = text.split("PERMISSION_DISPLAY_NAMES", 1)[1].split("\n};", 1)[0]
    names = dict(re.findall(r'"([a-z-]+:[a-z-]+)":\s*"([^"]+)"', names_block))

    return {code: names.get(code, "") for code in union}


def main():
    backend = backend_codes()
    frontend = frontend_codes()

    problems = []

    missing = sorted(set(backend) - set(frontend))
    if missing:
        details = "\n".join(f"    {code}（后端：{backend[code]}）" for code in missing)
        problems.append("后端认、前端没登记的权限码（前端会把这个入口藏起来）：\n" + details)

    extra = sorted(set(frontend) - set(backend))
    if extra:
        details = "\n".join(f"    {code}（前端：{frontend[code]}）" for code in extra)
        problems.append("前端登记了、后端不认的权限码（守卫放行，接口一律 403）：\n" + details)

    mismatched = sorted(
        code for code in set(backend) & set(frontend) if backend[code] != frontend[code]
    )
    if mismatched:
        details = "\n".join(
            f"    {code}：后端「{backend[code]}」／前端「{frontend[code]}」" for code in mismatched
        )
        problems.append("同一个权限码两边中文名不一样：\n" + details)

    unnamed = sorted(code for code in backend if not backend[code])
    if unnamed:
        details = "\n".join(f"    {code}" for code in unnamed)
        problems.append("后端没有中文名的权限码：\n" + details)

    if problems:
        print("权限点词表前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 PermissionCatalog 时，同步改 "
            "frontend/shared/src/auth/permissions.ts 的 PermissionPoint 与 "
            "PERMISSION_DISPLAY_NAMES（前端只改后端确实认的那些码）。"
        )
        return 1

    print(f"权限点词表一致：后端 {len(backend)} 个，前端登记 {len(frontend)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
