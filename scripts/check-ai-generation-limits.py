#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对 AI 生成试题的**数量上限**在三处是不是同一套：后端、前端、接口文档。

「一次最多生成几道」「出题要求最长多少字」「知识点标签最多几个」是
**前后端共享的契约**：后端 `AiGenerationRequestRules` 按它决定放行还是拒绝，
前端按它先在界面上拦住并提示，接口文档按它告诉调用方边界。

**两边各写一套时，症状是静默的**——2026-11-26 公测机上就出过：
老师把「生成数量」填出了服务端允许的范围，服务端按「一次最多 10 道题」
拒了（HTTP 400），
而前端界面上的数字输入框写着 `max=8`、提示语写着「1 到 10 之间」，
三处对不上，老师既不知道被哪儿拒了，也不知道自己能填多少。

这类漂移**不会让任何测试变红**：后端单测只测后端的常量，
前端单测只测前端的常量，两边各自都对，合起来就不对。
所以要有这道守卫把它们钉在一起。

用法：
    python3 scripts/check-ai-generation-limits.py
退出码非 0 表示三处对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_RULES = ROOT / "backend/src/Exam.Application/Catalog/Services/AiGenerationRequestRules.cs"
BACKEND_QUESTION = ROOT / "backend/src/Exam.Domain/Catalog/Question.cs"
FRONTEND_API = ROOT / "frontend/shared/src/api/aiApi.ts"
FRONTEND_ADMIN = ROOT / "frontend/admin/src/features/banks/BankWorkbenchPage.tsx"
DOC = ROOT / "docs/design/05-api.md"


def backend_const(text, name):
    """从后端 C# 源码里取 `public const int <name> = <值>;`。"""
    match = re.search(rf"public const int {name}\s*=\s*(\d+)\s*;", text)
    return int(match.group(1)) if match else None


def frontend_const(text, name):
    """从前端 TS 源码里取 `export const <name> = <值>;`。"""
    match = re.search(rf"export const {name}\s*=\s*(\d+)\s*;", text)
    return int(match.group(1)) if match else None


def main():
    rules_text = BACKEND_RULES.read_text(encoding="utf-8")
    question_text = BACKEND_QUESTION.read_text(encoding="utf-8")
    api_text = FRONTEND_API.read_text(encoding="utf-8")
    admin_text = FRONTEND_ADMIN.read_text(encoding="utf-8")
    doc_text = DOC.read_text(encoding="utf-8")

    problems = []

    # ---- 后端：规则类里的两个常量 + 领域层的标签上限 ----
    backend_max_count = backend_const(rules_text, "MaxCount")
    backend_max_prompt = backend_const(rules_text, "MaxPromptLength")
    backend_max_tags = backend_const(question_text, "MaxTagCount")

    if backend_max_count is None:
        problems.append("后端 AiGenerationRequestRules 里找不到 `MaxCount` 常量")
    if backend_max_prompt is None:
        problems.append("后端 AiGenerationRequestRules 里找不到 `MaxPromptLength` 常量")
    if backend_max_tags is None:
        problems.append("后端 Question 里找不到 `MaxTagCount` 常量")

    # ---- 前端：共享层导出的三个常量 ----
    frontend_max_count = frontend_const(api_text, "AI_MAX_COUNT")
    frontend_max_prompt = frontend_const(api_text, "AI_PROMPT_MAX_LENGTH")
    frontend_max_tags = frontend_const(api_text, "AI_MAX_TAGS")

    if frontend_max_count is None:
        problems.append(
            "前端共享层找不到 `AI_MAX_COUNT` 常量"
            "（应在 frontend/shared/src/api/aiApi.ts 里导出）"
        )
    if frontend_max_prompt is None:
        problems.append("前端共享层找不到 `AI_PROMPT_MAX_LENGTH` 常量")
    if frontend_max_tags is None:
        problems.append("前端共享层找不到 `AI_MAX_TAGS` 常量")

    # ---- 前端：管理端页面必须用常量，不能自己写死一个数 ----
    if frontend_max_count is not None:
        count_input = re.search(
            r'id="gen-count"(?P<body>.{0,400}?)value=\{genCount\}', admin_text, re.S
        )
        if count_input is None:
            problems.append("管理端找不到「生成数量」输入框（id=\"gen-count\"）")
        else:
            max_attr = re.search(r"max=\{([^}]*)\}", count_input.group("body"))
            if max_attr is None:
                problems.append("「生成数量」输入框没有写 max 属性")
            elif max_attr.group(1).strip() != "AI_MAX_COUNT":
                problems.append(
                    "「生成数量」输入框的 max 写死了 "
                    f"{max_attr.group(1)}，应改成共享常量 AI_MAX_COUNT"
                    f"（服务端上限是 {backend_max_count}）"
                )

        # 提交前的拦截也得用同一个常量。
        # 下限 1 是「至少出一道题」这个硬地板，前后端都写死 1 不会漂；
        # 会漂的是上限——上限变了而前端还守着旧数，就是这次公测机上的事故。
        if "AI_MAX_COUNT" not in admin_text:
            problems.append(
                "管理端提交前没有用 AI_MAX_COUNT 拦截生成数量"
                "（自己写死一个数，改服务端上限时前端不会跟着变）"
            )
        elif re.search(r"genCount\s*>\s*\d+", admin_text):
            problems.append(
                "管理端把生成数量的上限写死成了字面量，"
                "应改成共享常量 AI_MAX_COUNT"
            )

    # ---- 文档：接口文档里写的数字也要一样 ----
    doc_max_count = re.search(r"一次最多\s*(\d+)\s*道", doc_text)
    doc_max_prompt = re.search(r"出题要求最长\s*(\d+)\s*字", doc_text)
    if doc_max_count is None or doc_max_prompt is None:
        problems.append("接口文档里找不到「一次最多 N 道」「出题要求最长 N 字」这两句")
    else:
        if backend_max_count is not None and int(doc_max_count.group(1)) != backend_max_count:
            problems.append(
                f"接口文档写的「一次最多 {doc_max_count.group(1)} 道」"
                f"与后端的 {backend_max_count} 不一致"
            )
        if backend_max_prompt is not None and int(doc_max_prompt.group(1)) != backend_max_prompt:
            problems.append(
                f"接口文档写的「出题要求最长 {doc_max_prompt.group(1)} 字」"
                f"与后端的 {backend_max_prompt} 不一致"
            )

    # ---- 后端 ↔ 前端逐项比对 ----
    for label, backend_value, frontend_value, backend_name, frontend_name in (
        ("生成数量", backend_max_count, frontend_max_count, "MaxCount", "AI_MAX_COUNT"),
        ("出题要求长度", backend_max_prompt, frontend_max_prompt, "MaxPromptLength", "AI_PROMPT_MAX_LENGTH"),
        ("知识点标签数", backend_max_tags, frontend_max_tags, "MaxTagCount", "AI_MAX_TAGS"),
    ):
        if backend_value is None or frontend_value is None:
            continue
        if backend_value != frontend_value:
            problems.append(
                f"{label}上限对不上：后端 {backend_name}={backend_value}／"
                f"前端 {frontend_name}={frontend_value}"
            )

    if problems:
        print("AI 生成试题的数量上限三处对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 AiGenerationRequestRules.MaxCount / MaxPromptLength "
            "或 Question.MaxTagCount 时，同步改 frontend/shared/src/api/aiApi.ts "
            "里的 AI_MAX_COUNT / AI_PROMPT_MAX_LENGTH / AI_MAX_TAGS；"
            "管理端页面一律用这些共享常量，不要写死数字；"
            "接口文档 §5 里的那两句也要跟着改。"
        )
        return 1

    print(
        "AI 生成试题的数量上限三处一致："
        f"一次最多 {backend_max_count} 道／"
        f"出题要求最长 {backend_max_prompt} 字／"
        f"知识点标签最多 {backend_max_tags} 个。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
