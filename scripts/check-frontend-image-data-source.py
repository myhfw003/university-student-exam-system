#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对前端**镜像**的产物连的是真后端，不是 mock 演示数据。

前端有两条数据通路（`frontend/shared/src/api/dataSource.ts`）：

- **mock**：内容数据来自 `shared/src/mock/` 的本地示例数据，页面一个后端请求都不发；
- **http**：内容数据来自 `/api/v1/**`，登录态、服务端时钟、答案上行都走后端。

构建期不设 `VITE_DATA_SOURCE` 时走的是 mock。而 `frontend/Dockerfile` 产出的
镜像就是发到服务器上的那份——它一旦退回 mock，部署出来的系统是个**假系统**：
题目、成绩、监考全是示例数据，用户点的每一个操作都不落库。
这种问题在前端单测里看不出来（单测跑的是 mock 产物），
在容器里也看不出来（页面渲染得好好的），只有真的连库才知道。

所以在 CI 里静态核对三件事：

1. `frontend/Dockerfile` 声明了 `ARG VITE_DATA_SOURCE`，且默认值是 `http`；
2. 该变量确实被传进了构建环境（`ENV VITE_DATA_SOURCE=...`）；
3. 镜像构建时没把数据源改回 mock（compose 的 build args 里不许出现 mock）。

顺带核对第 4 条：`dataSource.ts` 把**空串**按「没配」处理。
镜像里没配 API 基地址时会传一个空串进来，而空串不是 undefined，
`apiBaseUrl()` 会返回空串，请求路径直接拼坏。

用法：
    python3 scripts/check-frontend-image-data-source.py
退出码非 0 表示镜像产物会连不上真后端。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DOCKERFILE = ROOT / "frontend/Dockerfile"
DATA_SOURCE = ROOT / "frontend/shared/src/api/dataSource.ts"
COMPOSE = ROOT / "deploy/docker-compose.yml"


def dockerfile_text():
    return DOCKERFILE.read_text(encoding="utf-8")


def check_arg_default(text):
    """`ARG VITE_DATA_SOURCE` 的默认值必须是 http。"""
    match = re.search(r"^\s*ARG\s+VITE_DATA_SOURCE\s*(?:=\s*(\S+))?\s*$", text, re.MULTILINE)
    if match is None:
        return "frontend/Dockerfile 里没有 ARG VITE_DATA_SOURCE"
    default = match.group(1)
    if default != "http":
        return (
            f"frontend/Dockerfile 里 ARG VITE_DATA_SOURCE 的默认值是 {default or '（空）'}，"
            "应是 http——否则镜像产物退回 mock 模式，发出去的是假系统"
        )
    return None


def check_env_passed(text):
    """变量要真的进到构建环境里，光声明不传等于没声明。"""
    if re.search(r"^\s*ENV\s+VITE_DATA_SOURCE\s*=\s*\$\{?VITE_DATA_SOURCE\}?\s*$", text, re.MULTILINE):
        return None
    return (
        "frontend/Dockerfile 里没有 ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE}——"
        "声明了变量但不传给 vite，构建期仍然走 mock 模式"
    )


def check_compose_not_mock(text):
    """compose 的 build args 不许把数据源改回 mock。"""
    problems = []
    for match in re.finditer(r"VITE_DATA_SOURCE\s*[=:]\s*(\S+)", text):
        if match.group(1).strip("\"'") == "mock":
            problems.append(
                f"deploy/docker-compose.yml 里把 VITE_DATA_SOURCE 设成了 mock（第 "
                f"{text[: match.start()].count(chr(10)) + 1} 行）"
            )
    return problems


def check_empty_string_handled(text):
    """`envValue` 必须把空串按「没配」处理。"""
    start = text.find("function envValue")
    if start < 0:
        return "frontend/shared/src/api/dataSource.ts 里找不到 envValue 函数"
    # 截到下一个导出为止：按花括号切会在类型标注里的 `}` 处提前截断。
    rest = text[start:]
    nxt = rest.find("\nexport ", 1)
    fn = rest if nxt < 0 else rest[:nxt]
    if re.search(r"\.length\s*>\s*0", fn):
        return None
    return (
        "frontend/shared/src/api/dataSource.ts 的 envValue 没有把空串按「没配」处理——"
        "镜像里没配 API 基地址时传进来的空串会让 apiBaseUrl() 返回空串"
    )


def main():
    problems = []

    dockerfile = dockerfile_text()
    for problem in (
        check_arg_default(dockerfile),
        check_env_passed(dockerfile),
    ):
        if problem:
            problems.append(problem)

    problems.extend(check_compose_not_mock(COMPOSE.read_text(encoding="utf-8")))

    problem = check_empty_string_handled(DATA_SOURCE.read_text(encoding="utf-8"))
    if problem:
        problems.append(problem)

    if problems:
        print("前端镜像的数据源配置有问题：")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print(
            "改法：在 frontend/Dockerfile 里声明 ARG VITE_DATA_SOURCE=http 并用 "
            "ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE} 传进构建环境；"
            "镜像部署时前端连的是 /api/v1（同源，由 nginx 反代），不要退回 mock。"
        )
        return 1

    print("前端镜像产物连真实后端：VITE_DATA_SOURCE 默认 http，构建环境已传入。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
