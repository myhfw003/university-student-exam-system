#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对练习开放单的状态码：后端的与前端登记的是不是同一套。

开放单的状态码是**前后端共享的词表**：管理端把它当查询参数发给后端
（`GET /practice-assignments?status=draft`），后端按 `FromStorage` 认它。
前端写错一个码，后端不会「忽略这个条件」，而是直接判
「练习状态取值不合法。」——整页筛选静默失败，而单元测试全绿。

中文名同理：后端 `Label` 与前端的 `PRACTICE_ASSIGNMENT_STATUS_LABEL`
必须一致，否则同一个状态在管理端与接口文档里显示成两个名字。

用法：
    python3 scripts/check-practice-status-codes.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_ENTITY = ROOT / "backend/src/Exam.Domain/Learning/PracticeAssignment.cs"
FRONTEND_DOMAIN = ROOT / "frontend/shared/src/domain/practice.ts"


def backend_status_pairs():
    """后端的状态码 → 中文名。

    `FromStorage` 列出全部状态码（这是权威清单），
    `Label` 给出中文名；`Label` 里没显式写的那一个（`_` 分支）取兜底文案。
    """
    text = BACKEND_ENTITY.read_text(encoding="utf-8")

    from_storage = dict(
        re.findall(
            r'"([a-z]+)"\s*=>\s*PracticeAssignmentStatus\.([A-Za-z]+)',
            text.split("FromStorage", 1)[1],
        )
    )

    label_block = text.split("Label(this PracticeAssignmentStatus", 1)[1]
    explicit_labels = dict(
        re.findall(
            r"PracticeAssignmentStatus\.([A-Za-z]+)\s*=>\s*\"([^\"]+)\"",
            label_block,
        )
    )
    fallback = None
    fallback_match = re.search(r"_\s*=>\s*\"([^\"]+)\"", label_block)
    if fallback_match:
        fallback = fallback_match.group(1)

    pairs = {}
    for code, member in from_storage.items():
        label = explicit_labels.get(member)
        if label is None:
            label = fallback
        if label is None:
            continue
        pairs[code] = label
    return pairs


def frontend_status_pairs():
    """前端登记的状态码 → 中文名。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")
    block = text.split("PRACTICE_ASSIGNMENT_STATUS_LABEL", 1)[1].split("\n};", 1)[0]
    return dict(re.findall(r"([a-z]+)\s*:\s*\"([^\"]+)\"", block))


def frontend_union_codes():
    """前端状态码联合类型里登记的码。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")
    block = text.split("export type PracticeAssignmentStatus =", 1)[1].split(";", 1)[0]
    return set(re.findall(r'"([a-z]+)"', block))


def main():
    backend = backend_status_pairs()
    frontend = frontend_status_pairs()
    union = frontend_union_codes()

    problems = []

    missing = sorted(set(backend) - set(frontend))
    if missing:
        details = "\n".join(f"    {code}（后端：{backend[code]}）" for code in missing)
        problems.append("后端认、前端没登记的状态码（筛选会被后端判非法值）：\n" + details)

    extra = sorted(set(frontend) - set(backend))
    if extra:
        details = "\n".join(f"    {code}" for code in extra)
        problems.append("前端登记了、后端不认的状态码（筛选项是空的）：\n" + details)

    mismatched = sorted(
        code for code in set(backend) & set(frontend) if backend[code] != frontend[code]
    )
    if mismatched:
        details = "\n".join(
            f"    {code}：后端「{backend[code]}」／前端「{frontend[code]}」" for code in mismatched
        )
        problems.append("同一个状态码两边中文名不一样：\n" + details)

    unlabeled = sorted(union - set(frontend))
    if unlabeled:
        details = "\n".join(f"    {code}" for code in unlabeled)
        problems.append("联合类型里有、中文名表里没有的状态码：\n" + details)

    stale = sorted(set(frontend) - union)
    if stale:
        details = "\n".join(f"    {code}" for code in stale)
        problems.append("中文名表里有、联合类型里没有的状态码：\n" + details)

    if problems:
        print("练习开放单状态码前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 PracticeAssignmentStatuses 时，同步改 "
            "frontend/shared/src/domain/practice.ts 的 PracticeAssignmentStatus 与 "
            "PRACTICE_ASSIGNMENT_STATUS_LABEL（前端只改后端确实认的那些码）。"
        )
        return 1

    print(f"练习开放单状态码一致：后端 {len(backend)} 个，前端登记 {len(union)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
