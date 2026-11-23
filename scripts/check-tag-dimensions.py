#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对标签维度的词表：后端的几维与前端的几维是不是一回事。

标签维度是**前后端共用的词表**：
- 后端 `TagGroup` 枚举决定有哪些维度，以及哪些维度之间能成父子
  （`IsContentDimension` / `CanNest`）；
- 前端 `TagGroup` 类型决定标签管理页能选哪些维度、父标签下拉里给哪些标签。

两边对不上，后果是**静默**的：
- 后端加了新维度、前端没跟上 → 前端不显示那个维度（标签「不见了」）；
- 前端多登记了后端没有的维度 → 筛选按那个维度筛，后端不认；
- **内容维度集合不一致 → 前端给不出可用的父标签**：
  后端允许「领域标签下挂知识点标签」（需求 FR-CAT-02 的验收例子
  「选『高等数学』命中其下所有知识点」），前端却只让同维度当父，
  于是这个层级在界面上根本建不出来——而接口是通的。

用法:
    python3 scripts/check-tag-dimensions.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND = ROOT / "backend/src/Exam.Domain/Catalog/TagGroup.cs"
FRONTEND = ROOT / "frontend/shared/src/domain/types.ts"


def backend_dimensions():
    """后端的维度：枚举成员 → 存储值。"""
    text = BACKEND.read_text(encoding="utf-8")

    if "public enum TagGroup" not in text:
        raise SystemExit(f"在 {BACKEND} 里找不到 TagGroup 枚举——维度词表的来源没了。")

    # ToStorage 的 switch 里就是「枚举成员 → 存储值」的对照表。
    # 只取 ToStorage 这一段——文件里还有 Label 的 switch（值是中文名），
    # 一起匹配会把对照表覆盖成中文名。
    body = text.split("public static string ToStorage", 1)[1].split("};", 1)[0]
    mapping = dict(re.findall(r"TagGroup\.(\w+)\s*=>\s*\"([^\"]+)\"", body))
    if not mapping:
        raise SystemExit(
            f"在 {BACKEND} 里找不到维度与存储值的对照（ToStorage）——"
            "维度词表的来源没了。"
        )

    return mapping


def backend_content_dimensions(mapping):
    """后端认定的内容维度（之间可以跨维度成树）。"""
    text = BACKEND.read_text(encoding="utf-8")

    if "IsContentDimension" not in text:
        raise SystemExit(
            f"在 {BACKEND} 里找不到 IsContentDimension——"
            "「哪些维度之间能成树」的权威来源没了。"
        )

    body = text.split("IsContentDimension", 1)[1].split(";", 1)[0]
    names = re.findall(r"TagGroup\.(\w+)", body)
    if not names:
        raise SystemExit("IsContentDimension 里没有列出任何维度。")

    return {mapping[name] for name in names if name in mapping}


def frontend_dimensions():
    """前端的维度：TagGroup 类型的取值。"""
    text = FRONTEND.read_text(encoding="utf-8")

    if "export type TagGroup" not in text:
        raise SystemExit(f"在 {FRONTEND} 里找不到 TagGroup 类型——维度词表的来源没了。")

    line = text.split("export type TagGroup", 1)[1].split(";", 1)[0]
    values = set(re.findall(r'"([^"]+)"', line))
    if not values:
        raise SystemExit("TagGroup 类型里没有登记任何维度。")

    return values


def frontend_content_dimensions():
    """前端登记的内容维度。"""
    text = FRONTEND.read_text(encoding="utf-8")

    if "CONTENT_TAG_GROUPS" not in text:
        raise SystemExit(
            f"在 {FRONTEND} 里找不到 CONTENT_TAG_GROUPS——"
            "前端没有登记内容维度，请先确认是不是被删了。"
        )

    # 类型标注里有 `TagGroup[]`，所以按「= [」切，别按 `]` 切。
    match = re.search(r"CONTENT_TAG_GROUPS[^=]*=\s*\[([^\]]*)\]", text)
    if not match:
        raise SystemExit("CONTENT_TAG_GROUPS 里没有登记任何维度。")

    values = set(re.findall(r'"([^"]+)"', match.group(1)))
    if not values:
        raise SystemExit("CONTENT_TAG_GROUPS 里没有登记任何维度。")

    return values


def main():
    backend = backend_dimensions()
    backend_values = set(backend.values())
    backend_content = backend_content_dimensions(backend)

    frontend = frontend_dimensions()
    frontend_content = frontend_content_dimensions()

    problems = []

    unknown = sorted(frontend - backend_values)
    if unknown:
        details = "\n".join(f"    {value}" for value in unknown)
        problems.append(
            "前端登记了、后端没有的维度（前端会按一个后端不认的维度筛）：\n" + details
        )

    missing = sorted(backend_values - frontend)
    # 组织维度只作用于用户、由后端单独管理（ADR-018），前端不显示它。
    if set(missing) - {"organization"}:
        details = "\n".join(f"    {value}" for value in missing)
        problems.append(
            "后端有、前端没登记的维度（前端不显示这个维度，标签「不见了」）：\n" + details
        )

    if backend_content != frontend_content:
        only_backend = sorted(backend_content - frontend_content)
        only_frontend = sorted(frontend_content - backend_content)
        details = []
        if only_backend:
            details.append("    后端有、前端没有：" + "、".join(only_backend))
        if only_frontend:
            details.append("    前端有、后端没有：" + "、".join(only_frontend))
        problems.append(
            "内容维度（之间可以跨维度成树的那些）对不上：\n" + "\n".join(details)
        )

    if problems:
        print("标签维度的词表前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：加维度时同时改后端 backend/src/Exam.Domain/Catalog/TagGroup.cs "
            "与前端 frontend/shared/src/domain/types.ts 的 TagGroup；"
            "「哪些维度之间能成树」还要同步 CONTENT_TAG_GROUPS 与 IsContentDimension。"
        )
        return 1

    print(
        f"标签维度词表一致：后端 {len(backend_values)} 个"
        f"（前端登记 {len(frontend)} 个，组织维度只作用于用户），"
        f"内容维度 {len(backend_content)} 个，两边一致。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
