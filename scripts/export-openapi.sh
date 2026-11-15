#!/usr/bin/env bash
# 导出 OpenAPI 契约到 docs/api/openapi.json。
#
# 契约取的是运行中的应用经 Swagger 中间件吐出来的那份 JSON，
# 与 Swagger UI 看到的一致——不会出现「文档里是一套、导出的是另一套」。
#
# 改了控制器、契约或注释就重新导出；CI 会核对仓库里这份是不是最新的。
#
# 用法：
#   bash scripts/export-openapi.sh              # 构建并导出
#   SKIP_BUILD=1 bash scripts/export-openapi.sh # 用现成的构建产物导出（CI 里用）
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT="${1:-docs/api/openapi.json}"
ABS_OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"

args=(--project backend/src/Exam.Web -c Release)

if [ "${SKIP_BUILD:-0}" = "1" ]; then
    args+=(--no-build)
fi

dotnet run "${args[@]}" -- --export-openapi "$ABS_OUTPUT"
