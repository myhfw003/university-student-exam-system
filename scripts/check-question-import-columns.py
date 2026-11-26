#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对试题导入模板的**列词表**：模板、解析器、前端三处是不是同一套。

导入模板是老师拿到手的第一份说明，它说「哪一列填什么」，解析器决定
「这一列到底被读进哪个字段」，前端决定「界面上叫什么、哪些必填」。
三处各写一套时，后果是**静默**的：

- 模板多了一列，解析器不认 → 老师照模板填了，导入时这一列**被丢掉**，
  没有报错，只在预览里看不到；
- 模板改了表头（如「步骤」→「评分步骤」），前端还按老名字提示 → 老师
  按界面的提示填，服务端列映射不上，整批都报「必须指定难度标签」；
- 前端把某列标成选填、后端要求必填 → 上传后每一行都失败。

所以这里核对三件事：

1. **模板**（后端 `QuestionImportTemplate`）与**前端那份模板**
   （`frontend/shared/src/mock/importTemplate.ts`）逐列相同：字段、表头、
   必填、说明、示例、顺序都要一样；
2. 模板的每个表头都要能被**解析器的别名表**认出来——不然模板自己
   都映射不上（下载下来的模板上传后必然对不上列）；
3. 前端列映射用的字段清单（`IMPORT_FIELDS`）与模板的字段一致：
   顺序、名称、必填都要一样。

用法：
    python3 scripts/check-question-import-columns.py
退出码非 0 表示三处对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_TEMPLATE = ROOT / "backend/src/Exam.Domain/Catalog/QuestionImportTemplate.cs"
BACKEND_PARSER = ROOT / "backend/src/Exam.Domain/Catalog/QuestionImportParser.cs"
FRONTEND_TEMPLATE = ROOT / "frontend/shared/src/mock/importTemplate.ts"
FRONTEND_FIELDS = ROOT / "frontend/admin/src/features/banks/importFile.ts"

# 模板一列：字段、表头、必填、说明、示例。
BACKEND_ENTRY = re.compile(
    r'new\(\s*"(\w+)",\s*"([^"]*)",\s*(true|false),\s*"([^"]*)",\s*"([^"]*)"\s*\)',
    re.S,
)
FRONTEND_ENTRY = re.compile(
    r'field:\s*"(\w+)",\s*header:\s*"([^"]*)",\s*required:\s*(true|false),\s*'
    r'description:\s*"([^"]*)",\s*example:\s*"([^"]*)"',
    re.S,
)
# 前端列映射清单：字段、显示名、必填。
FRONTEND_FIELD = re.compile(
    r'key:\s*"(\w+)",\s*label:\s*"([^"]*)",\s*required:\s*(true|false)', re.S
)
# 解析器的列名别名。
PARSER_ALIAS = re.compile(r'\["([^"]+)"\]\s*=\s*"(\w+)"')


def backend_columns():
    """后端模板的列定义。"""
    text = BACKEND_TEMPLATE.read_text(encoding="utf-8")
    block = text.split("Columns", 1)[1].split("[", 1)[1].split("\n    ];", 1)[0]
    return [
        (field, header, required == "true", description, example)
        for field, header, required, description, example in BACKEND_ENTRY.findall(block)
    ]


def frontend_columns():
    """前端模板的列定义。"""
    text = FRONTEND_TEMPLATE.read_text(encoding="utf-8")
    block = text.split("IMPORT_TEMPLATE_COLUMNS", 1)[1].split("];", 1)[0]
    return [
        (field, header, required == "true", description, example)
        for field, header, required, description, example in FRONTEND_ENTRY.findall(block)
    ]


def frontend_fields():
    """前端列映射清单。"""
    text = FRONTEND_FIELDS.read_text(encoding="utf-8")
    block = text.split("IMPORT_FIELDS", 1)[1].split("\n];", 1)[0]
    return [
        (field, label, required == "true")
        for field, label, required in FRONTEND_FIELD.findall(block)
    ]


def parser_aliases():
    """解析器认得的表头 → 标准字段。"""
    text = BACKEND_PARSER.read_text(encoding="utf-8")
    block = text.split("FieldAliases", 1)[1].split("\n    };", 1)[0]
    return dict(PARSER_ALIAS.findall(block))


def parser_supported_fields():
    """解析器支持的标准字段。"""
    text = BACKEND_PARSER.read_text(encoding="utf-8")
    block = text.split("SupportedFields", 1)[1].split("\n    ];", 1)[0]
    return re.findall(r'"(\w+)"', block)


def main():
    backend = backend_columns()
    frontend = frontend_columns()
    fields = frontend_fields()
    aliases = parser_aliases()
    supported = parser_supported_fields()

    problems = []

    if not backend:
        problems.append("后端模板里没解析出任何列定义（模板结构改了吗？）")
    if not frontend:
        problems.append("前端模板里没解析出任何列定义（模板结构改了吗？）")

    # ---- 1. 后端模板 ↔ 前端模板 ----
    backend_fields = [column[0] for column in backend]
    frontend_field_names = [column[0] for column in frontend]
    if backend_fields != frontend_field_names:
        problems.append(
            "模板的字段顺序或集合对不上：\n"
            f"    后端：{backend_fields}\n"
            f"    前端：{frontend_field_names}"
        )

    for backend_column, frontend_column in zip(backend, frontend):
        if backend_column == frontend_column:
            continue
        field = backend_column[0]
        problems.append(
            f"「{field}」列两边不一致：\n"
            f"    后端：{backend_column}\n"
            f"    前端：{frontend_column}"
        )

    # ---- 2. 模板表头要能被解析器认出来 ----
    for field, header, required, _description, _example in backend:
        if field not in supported:
            problems.append(f"模板里的字段「{field}」不在解析器支持的字段里（SupportedFields）。")
        if header not in aliases:
            problems.append(
                f"模板的表头「{header}」（字段 {field}）解析器认不出来："
                "老师照模板填好上传，这列会被静默丢掉。"
            )
        elif aliases[header] != field:
            problems.append(
                f"模板的表头「{header}」被解析器映射到字段「{aliases[header]}」，"
                f"但模板里它是「{field}」。"
            )

    # ---- 3. 前端列映射清单 ↔ 模板 ----
    template_fields = [(field, header, required) for field, header, required, _d, _e in backend]
    if fields != template_fields:
        problems.append(
            "前端列映射清单与模板对不上（字段、名称或必填不一致）：\n"
            f"    前端：{fields}\n"
            f"    模板：{template_fields}"
        )

    if problems:
        print("试题导入模板的列词表三处对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：模板的权威定义在后端 backend/src/Exam.Domain/Catalog/QuestionImportTemplate.cs；"
            "改它时同步改 frontend/shared/src/mock/importTemplate.ts 的 IMPORT_TEMPLATE_COLUMNS "
            "与 frontend/admin/src/features/banks/importFile.ts 的 IMPORT_FIELDS；"
            "新加的表头还要在 backend/src/Exam.Domain/Catalog/QuestionImportParser.cs 的 "
            "FieldAliases 里登记，否则这一列会被静默丢掉。"
        )
        return 1

    print(
        f"试题导入模板一致：{len(backend)} 列"
        f"（必填 {sum(1 for c in backend if c[2])} 列）；"
        "模板表头均能被解析器识别；前端列映射清单与模板一致。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
