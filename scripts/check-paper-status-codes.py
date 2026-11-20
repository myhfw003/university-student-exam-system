#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对试卷的状态码：后端的与前端登记的是不是同一套。

试卷的状态码是**前后端共享的词表**：
- 后端按它判状态流转（`Publish` / `Unpublish` / `Archive` 都认这几个码），
  列表接口的 `status` 参数也只认这几个值——不认就直接判
  「试卷状态取值不合法。」；
- 前端按它判断「这份试卷现在算什么状态」：组卷清单的状态标签、
  发布按钮、归档按钮都从这几个码推出来。

前端写错一个码，后端不会「忽略这个条件」，而是直接报错；而单元测试全绿，
只有联调时才炸。所以两边必须在 CI 里核对。

**中文名不在这里比**：试卷的中文名（草稿 / 已发布 / 已归档）由服务端
随 `statusLabel` 一起给，前端照抄，不另立一套——服务端改文案时管理端
不会显示成另一个名字。

用法：
    python3 scripts/check-paper-status-codes.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_ENTITY = ROOT / "backend/src/Exam.Domain/Authoring/PaperEnums.cs"
FRONTEND_DOMAIN = ROOT / "frontend/shared/src/domain/paper.ts"


def backend_status_codes():
    """后端认的状态码。

    `PaperStatuses.FromStorage` 列出全部状态码（这是权威清单）。
    """
    text = BACKEND_ENTITY.read_text(encoding="utf-8")
    section = text.split("public static class PaperStatuses", 1)[1]
    block = section.split("FromStorage", 1)[1].split("};", 1)[0]
    return set(re.findall(r'"([a-z]+)"\s*=>\s*PaperStatus\.', block))


def frontend_status_entries():
    """前端登记的状态码 → 属性名。

    `PAPER_STATUS` 是 `键: 值` 的表：键是前端用的名字，值是**发给/收到
    服务端的码**。键与值应当一一对应（`archived: "archived"`），
    对不上说明前端把状态码写错了地方。
    """
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")
    block = text.split("export const PAPER_STATUS =", 1)[1].split("} as const;", 1)[0]
    return dict(re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\"([a-z]+)\"", block))


def main():
    backend = backend_status_codes()
    entries = frontend_status_entries()
    frontend = set(entries.values())

    problems = []

    missing = sorted(backend - frontend)
    if missing:
        details = "\n".join(f"    {code}" for code in missing)
        problems.append("后端认、前端没登记的状态码（前端会把它当成不认识的状态）：\n" + details)

    extra = sorted(frontend - backend)
    if extra:
        details = "\n".join(f"    {code}" for code in extra)
        problems.append("前端登记了、后端不认的状态码（这个状态永远不会出现）：\n" + details)

    mismatched = sorted(key for key, value in entries.items() if key != value)
    if mismatched:
        details = "\n".join(
            f"    {key} → {entries[key]}（键与值对不上）" for key in mismatched
        )
        problems.append("前端登记表里键与值不一致（属性名应当就是状态码本身）：\n" + details)

    if problems:
        print("试卷状态码前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 PaperStatuses 时，同步改 "
            "frontend/shared/src/domain/paper.ts 的 PAPER_STATUS（前端只登记后端确实认的那些码）。"
        )
        return 1

    print(f"试卷状态码一致：后端 {len(backend)} 个，前端登记 {len(entries)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
