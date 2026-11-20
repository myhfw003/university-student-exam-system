#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对审计动作码：后端写出来的与前端登记的是不是同一套。

前端要按动作筛审计日志（FR-AUD-01 / FR-IAM-07），所以它必须知道后端
**真正会写出来的**动作码。两边对不上，后果是审计页上一半的动作显示成
一串原始码，筛选项里也选不到它们——这种错不会让任何测试变红，
只有人对着真实数据才能发现。

这个检查抓到过一类真实缺陷：
  - 前端自己编了一套 21 个动作码，后端实际写的是另外 65 个；
  - 后端把「撤销角色」写成 user.revoke-role，前端只有 user.assign-roles。

用法：
    python3 scripts/check-audit-action-codes.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_SRC = ROOT / "backend/src"
FRONTEND_TYPES = ROOT / "frontend/shared/src/domain/types.ts"
FRONTEND_AUDIT = ROOT / "frontend/shared/src/domain/audit.ts"

# 审计动作码的形状：`<域>.<动作>`，域与动作都是小写字母、数字、下划线或连字符。
ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*\.[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*$")

# 写审计的入口。第一个参数是动作码；RecordAsAsync 的动作码是第三个参数。
RECORD_CALL = re.compile(r"\.(RecordAsync|RecordAsAsync)\s*\(")
# 交卷收尾服务把动作码当作参数传进去（attempt.submit 等四条路径）。
FINALIZE_CALL = re.compile(r"\.FinalizeAsync\s*\(")

# EF 拦截器写的实体自动留痕：entity.<实体类型>.updated|deleted。
# 实体类型是运行期拼出来的，列不出全部，只能按前缀匹配，不参与逐个核对。
ENTITY_ACTION_PREFIX = "entity."


def split_arguments(text):
    """把括号里的实参按顶层逗号切开（嵌套的括号与字符串不算）。"""
    args = []
    current = ""
    depth = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            current += char
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            current += char
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if char == "," and depth == 0:
            args.append(current)
            current = ""
            continue
        current += char
    args.append(current)
    return args


def argument_of(text, start):
    """从 start（紧跟左括号之后）开始取出括号内的实参列表。"""
    depth = 1
    index = start
    in_string = False
    escaped = False
    while index < len(text) and depth:
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        index += 1
    return text[start : index - 1]


def literal_codes(block):
    """取出这段代码里所有「看起来像动作码」的字符串字面量。"""
    return re.findall(r'"([a-z][a-z0-9_]*(?:-[a-z0-9_]+)*\.[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*)"', block)


def backend_action_codes():
    """后端真正会写出来的审计动作码。"""
    codes = {}
    for path in sorted(BACKEND_SRC.rglob("*.cs")):
        text = path.read_text(encoding="utf-8")
        for match in RECORD_CALL.finditer(text):
            name = match.group(1)
            args = split_arguments(argument_of(text, match.end()))
            # RecordAsync(action, ...)：动作码是第一个实参。
            # RecordAsAsync(operatorId, operatorName, action, ...)：第三个。
            index = 0 if name == "RecordAsync" else 2
            if len(args) <= index:
                continue
            for code in literal_codes(args[index]):
                if ACTION_PATTERN.match(code):
                    codes.setdefault(code, set()).add(f"{path.relative_to(ROOT)}")
        # 交卷收尾：动作码由调用方传进来，四条路径各写各的。
        for match in FINALIZE_CALL.finditer(text):
            args = split_arguments(argument_of(text, match.end()))
            for arg in args:
                for code in literal_codes(arg):
                    if ACTION_PATTERN.match(code):
                        codes.setdefault(code, set()).add(f"{path.relative_to(ROOT)}")
    return codes


def frontend_union_codes():
    """前端 AuditAction 联合类型里登记的动作码。"""
    text = FRONTEND_TYPES.read_text(encoding="utf-8")
    block = text.split("export type AuditAction =", 1)[1].split(";", 1)[0]
    return set(re.findall(r'"([a-z][a-z0-9_]*(?:-[a-z0-9_]+)*\.[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*)"', block))


def frontend_label_codes():
    """前端中文名表里登记的动作码。"""
    text = FRONTEND_AUDIT.read_text(encoding="utf-8")
    block = text.split("export const AUDIT_ACTION_LABEL", 1)[1].split("\n};", 1)[0]
    return set(re.findall(r'"([a-z][a-z0-9_]*(?:-[a-z0-9_]+)*\.[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*)"\s*:', block))


def backend_entity_types():
    """后端实现了 IAuditedEntity 的实体——拦截器按类名小写拼动作码。"""
    names = set()
    domain = BACKEND_SRC / "Exam.Domain"
    for path in sorted(domain.rglob("*.cs")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"class\s+([A-Za-z0-9_]+)\s*:[^{]*\bIAuditedEntity\b", text):
            names.add(match.group(1).lower())
    return names


def frontend_entity_types():
    """前端中文名表里登记的实体类型。"""
    text = FRONTEND_AUDIT.read_text(encoding="utf-8")
    block = text.split("export const AUDIT_ENTITY_TYPE_LABEL", 1)[1].split("\n};", 1)[0]
    return set(re.findall(r"^\s*([a-z][a-z0-9_]*)\s*:", block, re.MULTILINE))


def main():
    backend = backend_action_codes()
    backend_codes = {code for code in backend if not code.startswith(ENTITY_ACTION_PREFIX)}
    union = frontend_union_codes()
    labels = frontend_label_codes()

    problems = []

    missing = sorted(backend_codes - union)
    if missing:
        details = "\n".join(f"    {code}（后端：{', '.join(sorted(backend[code]))}）" for code in missing)
        problems.append(
            "后端写得出、前端没登记的动作码（审计页上会显示成原始码，筛选项里也选不到）：\n" + details
        )

    extra = sorted(union - backend_codes)
    if extra:
        problems.append("前端登记了、后端不会写出来的动作码（筛选项是空的）：\n" + "\n".join(f"    {code}" for code in extra))

    unlabeled = sorted(union - labels)
    if unlabeled:
        problems.append("前端联合类型里有、中文名表里没有的动作码：\n" + "\n".join(f"    {code}" for code in unlabeled))

    stale = sorted(labels - union)
    if stale:
        problems.append("中文名表里有、联合类型里没有的动作码：\n" + "\n".join(f"    {code}" for code in stale))

    backend_entities = backend_entity_types()
    frontend_entities = frontend_entity_types()
    entity_missing = sorted(backend_entities - frontend_entities)
    if entity_missing:
        problems.append(
            "后端会自动留痕、前端没登记中文名的实体类型：\n" + "\n".join(f"    {name}" for name in entity_missing)
        )
    entity_extra = sorted(frontend_entities - backend_entities)
    if entity_extra:
        problems.append(
            "前端登记了、后端没有对应实体的类型：\n" + "\n".join(f"    {name}" for name in entity_extra)
        )

    if problems:
        print("审计动作码前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：后端新增动作码时，同步改 frontend/shared/src/domain/types.ts 的 AuditAction "
            "与 frontend/shared/src/domain/audit.ts 的中文名表（前端只改后端确实写出来的那些）。"
        )
        return 1

    print(f"审计动作码一致：后端 {len(backend_codes)} 个，前端登记 {len(union)} 个；实体类型 {len(backend_entities)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
