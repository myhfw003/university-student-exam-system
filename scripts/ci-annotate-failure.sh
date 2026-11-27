#!/usr/bin/env bash
# 把一份测试日志变成 GitHub 注解，让失败原因在「没有管理员权限」时也看得见。
#
# 作业日志与 artifact 只有管理员能下载，注解却对所有人可见——CI 偶发变红时，
# 这就是唯一能看出「哪条用例、报了什么错」的地方。
set -uo pipefail

log="${1:-}"
title="${2:-构建失败}"
tail_lines=200

if [ ! -f "$log" ]; then
  echo "::error::${title}（没有找到日志文件 ${log}）"
  exit 0
fi

total="$(wc -l < "$log" | tr -d ' ')"

# 去掉 ANSI 颜色码：测试框架的输出带颜色，注解里是一串乱码，看不出哪条挂了。
# 保留换行以便筛选，但整段最终要压成一行（见下面的 %0A）。
strip_ansi() {
  sed -e 's/\x1b\[[0-9;]*m//g' -e 's/\x1b\][^\x07]*\(\x07\|\x1b\\\)//g'
}

# 只有出现这些标记，才认定这份日志里真的有失败。
# 「Test Files 5 passed」这种小结行不能当失败标记，否则通过的日志也会被当成失败清单贴出来。
markers="$(strip_ansi < "$log" \
  | grep -E 'FAIL |✗|×|AssertionError|Error:' \
  | head -40)"

# 小结：跑了几个文件、几个用例。
summary="$(strip_ansi < "$log" \
  | grep -E 'Test Files|Tests  ' \
  | tail -4)"

if [ -z "$markers" ]; then
  # 这份日志里没有失败标记：要么日志本身是干净的，要么失败发生在别处。
  # 退回日志末尾，至少让人看得见现场。
  body="$(strip_ansi < "$log" | tail -n "$tail_lines")"
  printf '::error::%s（日志共 %s 行，没匹配到失败清单，可能是别处失败）：%s\n' \
    "$title" "$total" \
    "$(printf '%s' "$body" \
      | sed -e 's/%/%25/g' -e 's/\r/%0D/g' -e 's/$/%0A/' \
      | tr -d '\n')"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### ${title}"; echo
      echo "日志共 ${total} 行。没能匹配到失败清单，贴末尾现场："; echo
      echo '```'; printf '%s\n' "$body"; echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

# 失败清单：哪条挂了、报了什么错。再补上堆栈与断言细节。
context="$(strip_ansi < "$log" \
  | grep -E '❯ |expected |to be |to equal |to have ' \
  | head -20)"

digest="${markers}"$'\n'"……（以上为失败清单，完整输出见作业日志）"
if [ -n "$context" ]; then
  digest="${digest}"$'\n'"${context}"
fi
if [ -n "$summary" ]; then
  digest="${digest}"$'\n'"${summary}"
fi

# 注解正文必须占一行：换行写成 %0A，% 本身要先写成 %25。
body="$(printf '%s' "$digest" \
  | sed -e 's/%/%25/g' -e 's/\r/%0D/g' -e 's/$/%0A/' \
  | tr -d '\n')"

printf '::error::%s（日志共 %s 行）：%s\n' "$title" "$total" "$body"

# 作业摘要也能看（运行页上直接渲染），两份都留一份。
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### ${title}"; echo
    echo "日志共 ${total} 行。失败清单："; echo
    echo '```'; printf '%s\n' "$digest"; echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
