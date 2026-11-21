#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对能力画像的分档词表：后端写出来的与前端登记的是不是同一套。

能力画像的分档（掌握 / 熟悉 / 薄弱 / 样本不足）是**前后端共用的词表**：
- 后端 `GetAbilityProfileHandler.Label` 按掌握度与样本量算出这个分档，
  随 `masteryLabel` 一起发给前端；
- 前端按它决定徽标颜色，并登记在同一份词表里（mock 模式造示例数据也用它）。

两边对不上，后果是**静默**的：服务端改了文案，前端这个分档认不出来，
徽标就退回中性色——页面还是能看，但「薄弱」和「掌握」看起来一样，
而单元测试全绿。

中文名在这里**要比**（与试卷状态码那个脚本不同）：那个脚本比的是状态码，
中文名由服务端随 `statusLabel` 一起给；这里前端要按中文名上色，
所以中文名本身就是两边共享的词表。

用法:
    python3 scripts/check-ability-mastery-labels.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_QUERY = ROOT / "backend/src/Exam.Application/Learning/Queries/AbilityQueries.cs"
FRONTEND_DOMAIN = ROOT / "frontend/shared/src/domain/ability.ts"


def backend_labels():
    """后端会写出的分档文案。

    权威来源是 `Label` 方法：它按样本量与掌握度门槛返回其中之一。
    """
    text = BACKEND_QUERY.read_text(encoding="utf-8")

    if "private static string Label" not in text:
        raise SystemExit(
            f"在 {BACKEND_QUERY} 里找不到 Label 方法——"
            "分档词表的权威来源没了，请先确认后端是不是改了实现。"
        )

    # 只取 Label 方法体里的字符串字面量：方法后面的其它方法不算。
    body = text.split("private static string Label", 1)[1]
    body = body.split("\n    }", 1)[0]

    return set(re.findall(r'"([^"]+)"', body))


def frontend_labels():
    """前端登记的分档文案 → 属性名。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")

    if "export const MASTERY_LABEL" not in text:
        raise SystemExit(
            f"在 {FRONTEND_DOMAIN} 里找不到 MASTERY_LABEL——"
            "前端没有登记分档词表，请先确认是不是被删了。"
        )

    block = text.split("export const MASTERY_LABEL", 1)[1].split("} as const;", 1)[0]
    return dict(re.findall(r"(\w+)\s*:\s*\"([^\"]+)\"", block))


def main():
    backend = backend_labels()
    entries = frontend_labels()
    frontend = set(entries.values())

    problems = []

    missing = sorted(backend - frontend)
    if missing:
        details = "\n".join(f"    {label}" for label in missing)
        problems.append(
            "后端会写出、前端没登记的分档（前端认不出来，徽标会退回中性色）：\n" + details
        )

    extra = sorted(frontend - backend)
    if extra:
        # `entries` 是「属性名 → 文案」，这里要的是「文案 → 属性名」。
        # 直接拿文案去查 entries 会 KeyError——**校验脚本自己崩掉**，
        # 门禁就变成「报错但看不出哪里对不上」。
        property_by_label = {label: prop for prop, label in entries.items()}
        details = "\n".join(
            f"    {label}（前端属性名：{property_by_label.get(label, '?')}）" for label in extra
        )
        problems.append(
            "前端登记了、后端不会写出的分档（这个分档永远不会出现）：\n" + details
        )

    duplicated = sorted(
        label for label in frontend if list(entries.values()).count(label) > 1
    )
    if duplicated:
        details = "\n".join(f"    {label}" for label in duplicated)
        problems.append(f"前端同一个分档登记了多次：\n{details}")

    if problems:
        print("能力画像分档词表前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 AbilityQueries.Label 时，同步改 "
            "frontend/shared/src/domain/ability.ts 的 MASTERY_LABEL"
            "（前端只登记后端确实会写出的那些分档）。"
        )
        return 1

    print(f"能力画像分档词表一致：后端 {len(backend)} 个，前端登记 {len(entries)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
