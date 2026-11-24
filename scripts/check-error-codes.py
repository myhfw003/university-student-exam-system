#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对错误码：后端、前端文案表、设计文档三处必须是同一套。

错误码是**前后端共享的词表**：

- 后端 `ErrorCodes.cs` 定义码，`DomainException` 把码写进 ProblemDetails 的
  `errorCode` 扩展；
- 前端 `ERROR_MESSAGE_MAP` 按码取中文文案。前端写错一个码，界面就回落到
  按 HTTP 状态码兜底的通用提示——用户看到「操作不符合业务规则」而不是
  「对象存储未启用」，而所有测试都是绿的；
- 设计文档 `03-domain-model.md` §11 是这张表的权威清单。

三处各写一套时，漂移几乎不可见：单测照过、接口照通，只有用户在界面上
看到一句对不上的话。

用法：
    python3 scripts/check-error-codes.py
退出码非 0 表示三处对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_CODES = ROOT / "backend/src/Exam.Domain/SharedKernel/Exceptions/ErrorCodes.cs"
FRONTEND_MAP = ROOT / "frontend/shared/src/api/problemDetails.ts"
DESIGN_DOC = ROOT / "docs/design/03-domain-model.md"

DOC_SECTION = "## 11. 领域异常与错误码"
DOC_NEXT_SECTION = "## 12."


def backend_codes():
    """后端定义的错误码 → 码。"""
    text = BACKEND_CODES.read_text(encoding="utf-8")
    return dict(
        (code, name)
        for name, code in re.findall(r"public const int (\w+) = (\d+);", text)
    )


def frontend_codes():
    """前端文案表登记的码 → 文案。"""
    text = FRONTEND_MAP.read_text(encoding="utf-8")
    block = text.split("ERROR_MESSAGE_MAP", 1)[1].split("});", 1)[0]
    return dict(re.findall(r'(\d+):\s*"([^"]*)"', block))


def doc_codes():
    """设计文档 §11 登记的码 → 异常类型名。

    表格之外，文档还用「29001–29004 保留未用」这样的**区间**记述预留码段，
    这些码同样算「有文档」，一并解析进来。
    """
    text = DESIGN_DOC.read_text(encoding="utf-8")
    section = text.split(DOC_SECTION, 1)[1]
    section = section.split(DOC_NEXT_SECTION, 1)[0]

    table = dict(
        (code, name)
        for code, name in re.findall(r"\|\s*(\d+)\s*\|\s*`([^`]+)`", section)
    )

    # 区间记述：29001–29004 这样的写法（连字符、破折号、波浪号都算）。
    for low, high in re.findall(r"(\d{5})\s*[–—\-~]\s*(\d{5})", section):
        for code in range(int(low), int(high) + 1):
            table.setdefault(str(code), "（区间预留）")

    return table


def main():
    backend = backend_codes()
    frontend = frontend_codes()
    documented = doc_codes()

    problems = []

    missing_in_doc = sorted(set(backend) - set(documented))
    if missing_in_doc:
        details = "\n".join(f"    {code}（{backend[code]}）" for code in missing_in_doc)
        problems.append("后端有、设计文档 §11 没有登记：\n" + details)

    unknown_in_frontend = sorted(set(frontend) - set(backend))
    if unknown_in_frontend:
        details = "\n".join(f"    {code}（{frontend[code]}）" for code in unknown_in_frontend)
        problems.append("前端登记了、后端没有的错误码（文案永远取不到）：\n" + details)

    unknown_in_doc = sorted(set(documented) - set(backend))
    if unknown_in_doc:
        details = "\n".join(f"    {code}（{documented[code]}）" for code in unknown_in_doc)
        problems.append("设计文档登记了、后端没有的错误码：\n" + details)

    undocumented_in_frontend = sorted(set(frontend) - set(documented))
    if undocumented_in_frontend:
        details = "\n".join(f"    {code}" for code in undocumented_in_frontend)
        problems.append("前端登记了、设计文档 §11 没有的错误码：\n" + details)

    empty_messages = sorted(code for code, text in frontend.items() if not text.strip())
    if empty_messages:
        details = "\n".join(f"    {code}" for code in empty_messages)
        problems.append("前端文案表里文案是空的：\n" + details)

    if problems:
        print("错误码三处对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：后端在 backend/src/Exam.Domain/SharedKernel/Exceptions/ErrorCodes.cs "
            "定义码；前端在 frontend/shared/src/api/problemDetails.ts 的 "
            "ERROR_MESSAGE_MAP 登记中文文案；设计文档在 "
            "docs/design/03-domain-model.md §11 补上表格行。三处都要动。"
        )
        return 1

    print(
        f"错误码一致：后端 {len(backend)} 个，"
        f"文档登记 {len(documented)} 个，前端文案表 {len(frontend)} 个。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
