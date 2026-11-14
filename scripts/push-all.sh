#!/usr/bin/env bash
# ==========================================================================
#    同步推送到两个远端（Gitee + GitHub）
# --------------------------------------------------------------------------
#    仓库同时托管在 Gitee（远端名 origin）与 GitHub（远端名 github）。
#    普通 `git push` 只推当前分支的上游（origin），漏推 GitHub 就会让两个
#    平台的代码分叉——GitHub 上那份 .github/workflows/ci.yml 也就失去了
#    意义（那边有 Actions，平台不同）。
#
#    用法：
#      bash scripts/push-all.sh            # 推当前分支到两个远端
#      bash scripts/push-all.sh --tags     # 连同标签一起推
#
#    推完可以这样核对两个平台是否一致：
#      git rev-parse origin/master github/master
# ==========================================================================
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" = "HEAD" ]; then
  echo "当前处于分离 HEAD，先切到具体分支再推。" >&2
  exit 1
fi

echo "==> 推送 $branch 到 Gitee（origin）"
git push origin "$branch"

echo "==> 推送 $branch 到 GitHub（github）"
git push github "$branch"

if [ "${1:-}" = "--tags" ]; then
  echo "==> 推送标签到两个远端"
  git push origin --tags
  git push github --tags
fi

echo "==> 两个远端都已同步 $branch"
