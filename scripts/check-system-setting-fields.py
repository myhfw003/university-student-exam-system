#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对系统级设置的**字段**：后端 DTO 上的与前端登记的是不是同一套。

设置项的字段名也是前后端共用的契约：
- 后端 `SystemSettingsDto` 是 `GET/PUT /settings` 的响应体；
- 前端 `SystemSettings`（`frontend/shared/src/domain/settings.ts`）是它的映射目标。

两边对不上，后果是**静默**的：后端加了一个字段（比如「有没有配原始密码」），
前端没跟上，页面上那一块就一直显示成「没配」——管理员明明配过了却看不到，
而且单元测试全绿。

用法:
    python3 scripts/check-system-setting-fields.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_CONTRACTS = (
    ROOT / "backend/src/Exam.Application/Settings/Contracts/SettingsContracts.cs"
)
FRONTEND_DOMAIN = ROOT / "frontend/shared/src/domain/settings.ts"


def camel(name: str) -> str:
    """C# 属性名 → JSON 字段名（首字母小写）。"""
    return name[0].lower() + name[1:]


def backend_fields():
    """后端响应体上的字段（JSON 口径）。"""
    text = BACKEND_CONTRACTS.read_text(encoding="utf-8")

    marker = "public sealed record SystemSettingsDto("
    if marker not in text:
        raise SystemExit(
            f"在 {BACKEND_CONTRACTS} 里找不到 SystemSettingsDto——"
            "字段的权威来源没了，请先确认后端是不是改了实现。"
        )

    rest = text.split(marker, 1)[1]

    # 参数列表到与开括号配对的右括号为止。
    depth = 1
    buf = ""
    for ch in rest:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                break
        buf += ch

    # 泛型里的逗号不是参数分隔符：先去掉尖括号内容再按逗号拆。
    buf = re.sub(r"<[^<>]*>", "", buf)

    fields = set()
    for part in buf.split(","):
        part = part.strip()
        if not part:
            continue
        match = re.search(r"(\w+)\s*(?:=.*)?$", part)
        if match:
            fields.add(camel(match.group(1)))

    if not fields:
        raise SystemExit(
            "SystemSettingsDto 里没解析出任何字段——"
            "字段的权威来源没了，请先确认后端是不是改了实现。"
        )

    return fields


def frontend_fields():
    """前端登记的字段。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")

    marker = "export interface SystemSettings {"
    if marker not in text:
        raise SystemExit(
            f"在 {FRONTEND_DOMAIN} 里找不到 SystemSettings 接口——"
            "前端没有登记字段，请先确认是不是被删了。"
        )

    body = text.split(marker, 1)[1].split("\n}", 1)[0]
    fields = set(re.findall(r"^\s*(\w+)\??\s*:", body, re.M))

    if not fields:
        raise SystemExit("SystemSettings 接口里没有登记任何字段。")

    return fields


def main():
    backend = backend_fields()
    frontend = frontend_fields()

    problems = []

    missing = sorted(backend - frontend)
    if missing:
        details = "\n".join(f"    {field}" for field in missing)
        problems.append(
            "后端给了、前端没接的字段（前端读不到，页面上那一块一直是默认值）：\n"
            + details
        )

    extra = sorted(frontend - backend)
    if extra:
        details = "\n".join(f"    {field}" for field in extra)
        problems.append(
            "前端登记了、后端不会给的字段（永远是 undefined）：\n" + details
        )

    if problems:
        print("系统级设置的字段前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 SystemSettingsDto 的字段时，同步改 "
            "frontend/shared/src/domain/settings.ts 的 SystemSettings 接口，"
            "并在 shared/src/api/settingsApi.ts 的 toSystemSettings 里映射上。"
        )
        return 1

    print(
        f"系统级设置的字段前后端一致：后端 {len(backend)} 个，"
        f"前端登记 {len(frontend)} 个。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
