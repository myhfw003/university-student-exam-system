#!/usr/bin/env bash
# 跑一条命令，同时把它的输出写进日志文件，并**保留命令自己的退出码**。
#
# 为什么需要它：管道会把退出码换成管道最后一环的（tee 恒为 0），
# 于是「测试失败」会变成「步骤成功」——CI 绿灯，问题没被发现。
# 这里显式取 PIPESTATUS[0]（命令自己的状态）。
#
# 用法：ci-run-logged.sh <日志文件> <命令> [参数...]
set -o pipefail

log="$1"
shift

"$@" 2>&1 | tee "$log"
exit "${PIPESTATUS[0]}"
