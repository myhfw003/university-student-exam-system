#!/usr/bin/env bash
# 把日志文件末尾贴成一条注解（annotation），并在作业摘要里留一份。
#
# 为什么需要它：**作业日志要仓库管理员权限才看得到**，
# 注解却对任何人都可见（运行页与 check-runs API 上都能读到）。
# 前端作业偶发变红时，没有这条就只能看到「exit code 1」，
# 不知道是哪条用例挂了——这条就是补那个缺口。
#
# 用法：ci-annotate-failure.sh <日志文件> [标题]
set -uo pipefail

log="${1:-}"
title="${2:-构建失败}"
tail_lines=120

if [ ! -f "$log" ]; then
  echo "::error::${title}（没有找到日志文件 ${log}）"
  exit 0
fi

total="$(wc -l < "$log" | tr -d ' ')"

# 注解正文必须占一行：换行写成 %0A，% 本身要先写成 %25。
body="$(tail -n "$tail_lines" "$log" \
  | sed -e 's/%/%25/g' -e 's/\r/%0D/g' -e 's/$/%0A/' \
  | tr -d '\n')"

printf '::error::%s（日志共 %s 行，末尾 %s 行）：%s\n' "$title" "$total" "$tail_lines" "$body"

# 作业摘要也能看（运行页上直接渲染），两份都留一份。
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### ${title}"
    echo
    echo "日志共 ${total} 行，末尾 ${tail_lines} 行："
    echo
    echo '```'
    tail -n "$tail_lines" "$log"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
