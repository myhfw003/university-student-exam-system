#!/usr/bin/env bash
# 从备份恢复。
#
# 用法：
#   ./deploy/backup/restore.sh                       # 恢复到最新可用点
#   ./deploy/backup/restore.sh "2026-11-15 10:00:00" # 恢复到指定时间点
#
# 前提：postgres 容器已停止（恢复要写数据目录）。
#   cd deploy && docker compose stop postgres
#   ./backup/restore.sh
#   cd deploy && docker compose start postgres
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-exam-postgres-1}"
STANZA="${STANZA:-db}"
TARGET="${1:-latest}"

if [ "$TARGET" = "latest" ]; then
    echo "恢复到最新可用备份点。"
    docker exec "$PG_CONTAINER" pgbackrest --stanza="$STANZA" restore
else
    echo "恢复到 $TARGET。"
    docker exec "$PG_CONTAINER" pgbackrest --stanza="$STANZA" --type=time --target="$TARGET" restore
fi

echo "恢复完成。启动数据库后必须校验：表行数、外键关系、一次答卷对账。"
