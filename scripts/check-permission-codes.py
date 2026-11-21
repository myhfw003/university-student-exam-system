#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对权限点词表：后端的与前端登记的是不是同一套。

权限码是**前后端共享的词表**：

- 后端 `PermissionCatalog` 拿它判定每个请求能不能过；
- 前端 `PermissionPoint` 拿它判路由守卫、按钮显隐，
  管理端的角色权限矩阵还要按权限码回显中文名。

写错一个码的后果是**静默**的：前端多一个码，后端不认，路由守卫放行
但接口一律 403；前端少一个码，后端认了，前端却把入口藏起来。
这两种错都不会让任何测试变红。

中文名也要一致：管理端的权限矩阵按服务端的中文名显示，
mock 模式用的是前端词表里的中文名，两边不一样时同一个权限点
在两种模式下显示成两个名字。

**默认角色矩阵也一并核对**：后端种子
（`PermissionCatalog.DefaultRolePermissions`）与前端
（`ROLE_PERMISSIONS`）是两份写死的默认矩阵。两边不一样时，
mock 模式与真实后端对同一个角色给出不同的权限——
2026-11-21 就出过这种事：前端矩阵给出题教师 `exam:publish`
（能发布考试），后端种子没有；出题教师组好卷、建好场次，
却卡在「发布」上，而单元测试全绿。

**不核对库里那份**（`role_permission` 表）：管理员可以在管理端改角色的
权限集合，那是**运行期数据**，不是词表。

用法：
    python3 scripts/check-permission-codes.py
退出码非 0 表示两边对不上。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKEND_CATALOG = ROOT / "backend/src/Exam.Domain/Identity/PermissionCatalog.cs"
BACKEND_ROLE = ROOT / "backend/src/Exam.Domain/Identity/Role.cs"
FRONTEND_PERMISSIONS = ROOT / "frontend/shared/src/auth/permissions.ts"


def backend_codes():
    """后端的权限码 → 中文名。"""
    text = BACKEND_CATALOG.read_text(encoding="utf-8")
    codes = dict(re.findall(r'public const string (\w+) = "([^"]+)";', text))

    names_block = text.split("DisplayNames", 1)[1]
    names = dict(re.findall(r'\[(\w+)\]\s*=\s*"([^"]+)"', names_block))
    display = {codes[const]: label for const, label in names.items() if const in codes}

    # 全部权限码（All 列表里逐个列出来的那些）。
    all_block = text.split("public static IReadOnlyList<string> All", 1)[1]
    listed = [codes[name] for name in re.findall(r"\b([A-Z][A-Za-z]+)\b", all_block) if name in codes]
    return {code: display.get(code, "") for code in listed}


def backend_role_permissions():
    """后端默认角色矩阵：角色码 → 权限码集合。"""
    text = BACKEND_CATALOG.read_text(encoding="utf-8")
    codes = dict(re.findall(r'public const string (\w+) = "([^"]+)";', text))

    role_text = BACKEND_ROLE.read_text(encoding="utf-8")
    role_codes = dict(re.findall(r'public const string (\w+) = "([^"]+)";', role_text))

    # 只取那本字典：后面的 DisplayNames 里也有权限常量名，别混进来。
    block = text.split("DefaultRolePermissions", 1)[1].split("\n        };", 1)[0]

    all_codes = set(backend_codes())

    roles = {}
    for chunk in block.split("[Role.Codes.")[1:]:
        const = chunk.split("]", 1)[0].strip()
        body = chunk.split("]", 1)[1]
        # 系统管理员 = 全部权限。
        # 注意用词边界：`AttemptReadAll` 里也含 "All"，不能按子串判断。
        if re.search(r"(?<![A-Za-z])All(?![A-Za-z])", body):
            roles[role_codes.get(const, const)] = set(all_codes)
            continue
        names = re.findall(r"\b([A-Z][A-Za-z]+)\b", body)
        roles[role_codes.get(const, const)] = {codes[name] for name in names if name in codes}
    return roles


def frontend_codes():
    """前端的权限码 → 中文名。"""
    text = FRONTEND_PERMISSIONS.read_text(encoding="utf-8")

    union_block = text.split("export type PermissionPoint =", 1)[1].split(";", 1)[0]
    union = re.findall(r'"([a-z-]+:[a-z-]+)"', union_block)

    names_block = text.split("PERMISSION_DISPLAY_NAMES", 1)[1].split("\n};", 1)[0]
    names = dict(re.findall(r'"([a-z-]+:[a-z-]+)":\s*"([^"]+)"', names_block))

    return {code: names.get(code, "") for code in union}


def frontend_role_permissions():
    """前端默认角色矩阵：角色码 → 权限码集合。

    矩阵里用 `...READ_ONLY_TAG` 这样的常量展开，先把常量解开。
    """
    text = FRONTEND_PERMISSIONS.read_text(encoding="utf-8")

    consts = {}
    for name, body in re.findall(
        r"const (\w+): readonly PermissionPoint\[\] = \[([^\]]*)\];", text
    ):
        consts[name] = re.findall(r'"([a-z-]+:[a-z-]+)"', body)

    block = text.split("export const ROLE_PERMISSIONS", 1)[1].split("\n};", 1)[0]

    roles = {}
    for role, body in re.findall(r"\n  (\w+):\s*\[(.*?)\n  \],", block, re.S):
        codes = []
        for literal, spread in re.findall(r'"([a-z-]+:[a-z-]+)"|\.\.\.(\w+)', body):
            if literal:
                codes.append(literal)
            else:
                codes.extend(consts.get(spread, []))
        roles[role] = set(codes)
    return roles


def main():
    backend = backend_codes()
    frontend = frontend_codes()

    problems = []

    missing = sorted(set(backend) - set(frontend))
    if missing:
        details = "\n".join(f"    {code}（后端：{backend[code]}）" for code in missing)
        problems.append("后端认、前端没登记的权限码（前端会把这个入口藏起来）：\n" + details)

    extra = sorted(set(frontend) - set(backend))
    if extra:
        details = "\n".join(f"    {code}（前端：{frontend[code]}）" for code in extra)
        problems.append("前端登记了、后端不认的权限码（守卫放行，接口一律 403）：\n" + details)

    mismatched = sorted(
        code for code in set(backend) & set(frontend) if backend[code] != frontend[code]
    )
    if mismatched:
        details = "\n".join(
            f"    {code}：后端「{backend[code]}」／前端「{frontend[code]}」" for code in mismatched
        )
        problems.append("同一个权限码两边中文名不一样：\n" + details)

    unnamed = sorted(code for code in backend if not backend[code])
    if unnamed:
        details = "\n".join(f"    {code}" for code in unnamed)
        problems.append("后端没有中文名的权限码：\n" + details)

    # ---- 默认角色矩阵 ----
    backend_roles = backend_role_permissions()
    frontend_roles = frontend_role_permissions()

    for role in sorted(set(backend_roles) | set(frontend_roles)):
        backend_set = backend_roles.get(role)
        frontend_set = frontend_roles.get(role)
        if backend_set is None:
            problems.append(f"前端矩阵有、后端种子没有的角色：{role}")
            continue
        if frontend_set is None:
            problems.append(f"后端种子有、前端矩阵没有的角色：{role}")
            continue

        only_backend = sorted(backend_set - frontend_set)
        if only_backend:
            details = "\n".join(f"    {code}" for code in only_backend)
            problems.append(
                f"角色 {role}：后端种子有、前端矩阵没有的权限点"
                "（mock 模式按前端矩阵判，真实后端按种子判）：\n" + details
            )

        only_frontend = sorted(frontend_set - backend_set)
        if only_frontend:
            details = "\n".join(f"    {code}" for code in only_frontend)
            problems.append(
                f"角色 {role}：前端矩阵有、后端种子没有的权限点"
                "（前端会放出入口，后端一律 403）：\n" + details
            )

    if problems:
        print("权限点词表前后端对不上：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：改后端 PermissionCatalog 时，同步改 "
            "frontend/shared/src/auth/permissions.ts 的 PermissionPoint 与 "
            "PERMISSION_DISPLAY_NAMES（前端只改后端确实认的那些码）；"
            "角色的权限集合以需求文档 §1 的矩阵为准，后端种子与前端 ROLE_PERMISSIONS "
            "两边都要改。"
        )
        return 1

    print(
        f"权限点词表一致：后端 {len(backend)} 个，前端登记 {len(frontend)} 个；"
        f"默认角色矩阵 {len(backend_roles)} 个角色一致。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
