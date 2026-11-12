#!/usr/bin/env bash
# 构建全部镜像。
#
# 注意：若容器内 DNS 不可用（宿主使用 127.0.0.53 这类 systemd-resolved stub 解析器时
# 常见），NuGet 拉取会失败。此时用宿主网络构建：BUILD_NETWORK=host。
set -euo pipefail

cd "$(dirname "$0")/.."

NETWORK="${BUILD_NETWORK:-default}"
LEGACY="${BUILD_LEGACY:-0}"

# BuildKit 不采纳 --network=host：RUN 步骤仍用自己的网络命名空间。
# 宿主 DNS 在容器内不可达时，用经典构建器（走宿主解析器）绕过。
if [[ "${LEGACY}" == "1" ]]; then
  export DOCKER_BUILDKIT=0
  echo "使用经典构建器（DOCKER_BUILDKIT=0）。"
fi

build() {
  docker build --network="${NETWORK}" "$@"
}

echo "构建后端镜像（network=${NETWORK}）..."
build --target runtime -t exam-backend:dev backend/
build --target worker  -t exam-worker:dev  backend/

echo "构建前端镜像（network=${NETWORK}）..."
build -t exam-web:dev frontend/

echo "完成。启动：docker compose -f deploy/docker-compose.yml up -d"
