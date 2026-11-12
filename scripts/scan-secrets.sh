#!/usr/bin/env bash
# 密钥扫描：禁止把密码、私钥、令牌值提交到版本库。
# CI 中命中即失败。
set -uo pipefail

cd "$(dirname "$0")/.."

PATTERNS='(password|passwd|pwd|secret|private_key|apikey|api_key|access_token|connectionstring)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$\{][^"'"'"']{5,}'

# 测试目录中的字面量是测试夹具（假密码、假令牌），不是密钥，故排除。
EXCLUDES=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=bin --exclude-dir=obj
          --exclude-dir=dist --exclude-dir=Migrations --exclude-dir=tests --exclude-dir=secrets --exclude='*.example'
          --exclude='*.md' --exclude='scan-secrets.sh')

MATCHES=$(grep -rInE "${PATTERNS}" "${EXCLUDES[@]}" . 2>/dev/null | grep -v '^\./\.env$' || true)

if [[ -n "${MATCHES}" ]]; then
  echo "检测到疑似硬编码密钥："
  echo "${MATCHES}"
  echo "请改用环境变量注入。"
  exit 1
fi

echo "密钥扫描通过。"
