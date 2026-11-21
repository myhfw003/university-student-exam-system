#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对系统级设置的取值词表：后端会写出的与前端登记的是不是同一套。

设置项的**取值**是前后端共用的词表：
- 后端 `MistakeResolutionPolicies` 决定「重做正确后」错题怎么处理，
  把它落库成一个字符串（`remove` / `keep_mastered`）；
- 前端按同一个取值显示中文名、决定管理端页面上的说明，
  并把它原样发回去（`PUT /settings`）。

两边对不上，后果是**静默**的：前端把后端写的取值认不出来，
退回缺省档（移出错题本）——管理员明明改成了「保留但标记已掌握」，
页面却显示成另一档，而且单元测试全绿。

用法:
    python3 scripts/check-system-setting-values.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_DOMAIN = ROOT / "backend/src/Exam.Domain/Settings/SystemSetting.cs"
FRONTEND_DOMAIN = ROOT / "frontend/shared/src/domain/settings.ts"


def backend_values():
    """后端会写出的取值。

    权威来源是 `MistakeResolutionPolicies` 里的 const 字段：
    `ToStorage` 落库、`FromStorage` 解析，用的都是它们。
    """
    text = BACKEND_DOMAIN.read_text(encoding="utf-8")

    if "public static class MistakeResolutionPolicies" not in text:
        raise SystemExit(
            f"在 {BACKEND_DOMAIN} 里找不到 MistakeResolutionPolicies——"
            "取值词表的权威来源没了，请先确认后端是不是改了实现。"
        )

    class_body = text.split("public static class MistakeResolutionPolicies", 1)[1]
    fields = dict(
        re.findall(r'public const string (\w+)\s*=\s*"([^"]+)"', class_body)
    )

    if not fields:
        raise SystemExit(
            "MistakeResolutionPolicies 里没有 const string 字段——"
            "取值词表的权威来源没了，请先确认后端是不是改了实现。"
        )

    return set(fields.values())


def frontend_values():
    """前端登记的取值 → 中文名。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")

    if "export const MISTAKE_RESOLUTION_POLICY" not in text:
        raise SystemExit(
            f"在 {FRONTEND_DOMAIN} 里找不到 MISTAKE_RESOLUTION_POLICY——"
            "前端没有登记取值词表，请先确认是不是被删了。"
        )

    block = text.split("export const MISTAKE_RESOLUTION_POLICY", 1)[1].split("} as const;", 1)[0]
    values = set(re.findall(r':\s*"([^"]+)"', block))

    if not values:
        raise SystemExit("MISTAKE_RESOLUTION_POLICY 里没有登记任何取值。")

    return values


def frontend_labels():
    """前端登记的取值 → 中文名。键是取值本身。"""
    text = FRONTEND_DOMAIN.read_text(encoding="utf-8")

    if "MISTAKE_RESOLUTION_POLICY_LABEL" not in text:
        raise SystemExit(
            f"在 {FRONTEND_DOMAIN} 里找不到 MISTAKE_RESOLUTION_POLICY_LABEL——"
            "前端没有登记中文名，请先确认是不是被删了。"
        )

    block = (
        text.split("MISTAKE_RESOLUTION_POLICY_LABEL", 1)[1]
        .split("}", 1)[0]
    )
    return dict(re.findall(r'([a-z_]+)\s*:\s*"([^"]+)"', block))


def main():
    backend = backend_values()
    frontend = frontend_values()
    labels = frontend_labels()

    problems = []

    missing = sorted(backend - frontend)
    if missing:
        details = "\n".join(f"    {value}" for value in missing)
        problems.append(
            "后端会写出、前端没登记的取值（前端认不出来，会退回缺省档）：\n" + details
        )

    extra = sorted(frontend - backend)
    if extra:
        details = "\n".join(f"    {value}" for value in extra)
        problems.append(
            "前端登记了、后端不会写出的取值（这个取值永远不会被选中）：\n" + details
        )

    # 中文名要覆盖每一个取值：少一个，页面就会显示成空标签。
    label_missing = sorted(v for v in frontend if v not in labels)
    if label_missing:
        details = "\n".join(f"    {value}" for value in label_missing)
        problems.append("前端没有给这些取值登记中文名：\n" + details)

    if problems:
        print("系统级设置的取值词表前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 MistakeResolutionPolicies 的取值时，同步改 "
            "frontend/shared/src/domain/settings.ts 的 MISTAKE_RESOLUTION_POLICY "
            "（前端只登记后端确实会写出的那些取值）。"
        )
        return 1

    print(
        f"系统级设置的取值词表一致：后端 {len(backend)} 个，"
        f"前端登记 {len(frontend)} 个，中文名 {len(labels)} 个。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
