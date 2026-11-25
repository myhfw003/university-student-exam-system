#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对名单 CSV 的**列名词表**与**密码规则常量**：前后端是不是同一套。

名单列名是**前后端共享的词表**：

- 后端 `UserRosterCsvParser` 按表头找列，决定每个字段从哪一列取；
- 前端 `frontend/shared/src/mock/roster.ts` 的 `parseRosterCsv` 按同一套词表
  解析预览，界面上提示教师用哪些列名。

两边对不上时，后果是**静默**的：2026-11-25 就出过——管理端界面提示教师填
「**初始密码**」列，后端词表里只有「密码」，那一列被**静默丢弃**，
整批账号落到系统设定的原始密码上，没有任何提示；而教师以为给每个学生
都设了初始密码。测试全绿，因为前端那侧用的是 mock 解析器。

**必填列**（账号 / 姓名）也一并核对：后端缺列直接报错，前端缺列也报错，
两边必须认同一批必填列。

**密码规则常量**（最短 / 最长长度）也一并核对：后端 `PasswordPolicy` 是
最终裁决者，前端的预览与改密表单按同一组常量提示，避免前端放行、后端拒绝。

用法：
    python3 scripts/check-roster-columns.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_PARSER = ROOT / "backend/src/Exam.Infrastructure/Identity/UserRosterCsvParser.cs"
BACKEND_POLICY = ROOT / "backend/src/Exam.Domain/Identity/PasswordPolicy.cs"
FRONTEND_ROSTER = ROOT / "frontend/shared/src/mock/roster.ts"
FRONTEND_POLICY = ROOT / "frontend/shared/src/domain/password.ts"

# 名单里必须有的列（缺了就整批导入不了）。
REQUIRED_FIELDS = ["account", "name"]


def parse_pairs(text, pattern):
    """按 pattern 抽出 (字段, 关键词列表) 序列。"""
    pairs = []
    for field, body in re.findall(pattern, text, re.S):
        pairs.append((field, re.findall(r'"([^"]*)"', body)))
    return pairs


def backend_columns():
    """后端列名词表：字段 → 关键词列表（保持声明顺序）。"""
    text = BACKEND_PARSER.read_text(encoding="utf-8")
    block = text.split("Columns =", 1)[1].split("\n    ];", 1)[0]
    return parse_pairs(block, r'\("(\w+)",\s*\[(.*?)\]')


def frontend_columns():
    """前端列名词表：字段 → 关键词列表（保持声明顺序）。"""
    text = FRONTEND_ROSTER.read_text(encoding="utf-8")
    block = text.split("const COLUMN_KEYWORDS", 1)[1].split("\n];", 1)[0]
    return parse_pairs(block, r'field:\s*"(\w+)",\s*keywords:\s*\[(.*?)\]')


def backend_policy():
    """后端密码规则常量：最短长度、最长长度。"""
    text = BACKEND_POLICY.read_text(encoding="utf-8")
    min_length = re.search(r"MinLength\s*=\s*(\d+)", text)
    max_length = re.search(r"MaxLength\s*=\s*(\d+)", text)
    return (
        int(min_length.group(1)) if min_length else None,
        int(max_length.group(1)) if max_length else None,
    )


def frontend_policy():
    """前端密码规则常量：最短长度、最长长度。"""
    text = FRONTEND_POLICY.read_text(encoding="utf-8")
    min_length = re.search(r"PASSWORD_MIN_LENGTH\s*=\s*(\d+)", text)
    max_length = re.search(r"PASSWORD_MAX_LENGTH\s*=\s*(\d+)", text)
    return (
        int(min_length.group(1)) if min_length else None,
        int(max_length.group(1)) if max_length else None,
    )


def main():
    backend = backend_columns()
    frontend = frontend_columns()
    problems = []

    backend_fields = [field for field, _ in backend]
    frontend_fields = [field for field, _ in frontend]

    if backend_fields != frontend_fields:
        problems.append(
            "列字段的顺序或集合对不上：\n"
            f"    后端：{backend_fields}\n"
            f"    前端：{frontend_fields}"
        )

    backend_map = dict(backend)
    frontend_map = dict(frontend)

    for field in sorted(set(backend_map) & set(frontend_map)):
        only_backend = [k for k in backend_map[field] if k not in frontend_map[field]]
        only_frontend = [k for k in frontend_map[field] if k not in backend_map[field]]
        if only_backend:
            problems.append(
                f"「{field}」列：后端多认 {only_backend}（前端提示里没有，"
                "教师按前端的提示填，后端能认；反过来就会丢列）"
            )
        if only_frontend:
            problems.append(
                f"「{field}」列：前端多认 {only_frontend}"
                "（后端会静默丢弃这一列，教师填了也白填）"
            )
        if backend_map[field] != frontend_map[field] and not only_backend and not only_frontend:
            problems.append(
                f"「{field}」列关键词顺序不同："
                f"后端 {backend_map[field]}／前端 {frontend_map[field]}"
            )

    for field in REQUIRED_FIELDS:
        if field not in backend_map:
            problems.append(f"后端词表里没有必填列「{field}」")
        if field not in frontend_map:
            problems.append(f"前端词表里没有必填列「{field}」")

    backend_min, backend_max = backend_policy()
    frontend_min, frontend_max = frontend_policy()
    if (backend_min, backend_max) != (frontend_min, frontend_max):
        problems.append(
            "密码规则常量对不上："
            f"后端 [{backend_min}, {backend_max}]／"
            f"前端 [{frontend_min}, {frontend_max}]"
        )

    if problems:
        print("名单列名词表 / 密码规则前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 UserRosterCsvParser.Columns 时，同步改 "
            "frontend/shared/src/mock/roster.ts 的 COLUMN_KEYWORDS（字段顺序、"
            "关键词逐字一致）；改后端 PasswordPolicy 的长度常量时，同步改 "
            "frontend/shared/src/domain/password.ts 的 PASSWORD_MIN_LENGTH / "
            "PASSWORD_MAX_LENGTH。"
        )
        return 1

    print(
        f"名单列名词表一致：{len(backend)} 个字段"
        f"（必填 {', '.join(REQUIRED_FIELDS)}）；"
        f"密码规则常量一致：最短 {backend_min} 位、最长 {backend_max} 位。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
