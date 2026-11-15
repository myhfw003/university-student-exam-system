#!/usr/bin/env bash
# 恢复演练：把备份恢复到临时实例，逐表校验数据。
#
# 目的：证明「备份能恢复」不是纸面承诺——每个季度真跑一遍，
# 把行数校验与耗时记进《06-backup-restore-drill.md》。
#
# 用法（宿主机）：
#   PG_CONTAINER=exam-postgres-1 PG_SUPERUSER=exam_owner \
#     ./deploy/backup/restore-drill.sh [目标库名]
#
# 环境变量：
#   PG_CONTAINER   postgres 容器名（默认 exam-postgres-1）
#   PG_SUPERUSER   拥有者账号（默认 exam_owner）
#   PG_DATABASE    源库（默认 exam）
#   TARGET_DATABASE 目标库（默认 exam_restore）

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-exam-postgres-1}"
PG_SUPERUSER="${PG_SUPERUSER:-exam_owner}"
PG_DATABASE="${PG_DATABASE:-exam}"
TARGET_DATABASE="${1:-exam_restore}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

psql_in() {
    docker exec -i "$PG_CONTAINER" psql -U "$PG_SUPERUSER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"
}

echo "== 1/5 全量备份（$PG_DATABASE → $WORKDIR）=="
BACKUP_START=$(date +%s)
docker exec "$PG_CONTAINER" pg_dump -U "$PG_SUPERUSER" -Fc -f "/tmp/exam-drill.dump" "$PG_DATABASE"
docker cp "$PG_CONTAINER:/tmp/exam-drill.dump" "$WORKDIR/exam.dump" >/dev/null
docker exec "$PG_CONTAINER" rm -f /tmp/exam-drill.dump
BACKUP_END=$(date +%s)
echo "备份耗时 $((BACKUP_END - BACKUP_START)) 秒，大小 $(du -h "$WORKDIR/exam.dump" | cut -f1)"

echo "== 2/5 恢复到临时实例（$TARGET_DATABASE）=="
RESTORE_START=$(date +%s)
psql_in postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DATABASE\";"
psql_in postgres -c "CREATE DATABASE \"$TARGET_DATABASE\" TEMPLATE template0;"
docker cp "$WORKDIR/exam.dump" "$PG_CONTAINER:/tmp/exam-restore.dump" >/dev/null
docker exec "$PG_CONTAINER" pg_restore -U "$PG_SUPERUSER" -d "$TARGET_DATABASE" --no-owner --no-privileges -f /tmp/exam-restore.dump /tmp/exam-restore.dump 2>/dev/null \
    || docker exec "$PG_CONTAINER" pg_restore -U "$PG_SUPERUSER" -d "$TARGET_DATABASE" --no-owner --no-privileges /tmp/exam-restore.dump
docker exec "$PG_CONTAINER" rm -f /tmp/exam-restore.dump
RESTORE_END=$(date +%s)
echo "恢复耗时 $((RESTORE_END - RESTORE_START)) 秒"

echo "== 3/5 逐表比对行数 =="
count_query="
SELECT string_agg(
    format('SELECT %L AS t, count(*)::bigint AS c FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
    ' UNION ALL ')
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"

query="$(psql_in "$PG_DATABASE" -At -c "$count_query")"
psql_in "$PG_DATABASE" -At -F'|' -c "$query" | sort > "$WORKDIR/source.txt"
psql_in "$TARGET_DATABASE" -At -F'|' -c "$query" | sort > "$WORKDIR/target.txt"

if diff -u "$WORKDIR/source.txt" "$WORKDIR/target.txt" > "$WORKDIR/diff.txt"; then
    echo "行数校验通过：$(wc -l < "$WORKDIR/source.txt") 张表全部一致。"
else
    echo "行数校验失败，差异如下："
    cat "$WORKDIR/diff.txt"
    exit 1
fi

echo "== 4/5 关键数据抽样 =="
psql_in "$TARGET_DATABASE" -At -F'|' -c "
SELECT 'schema_count', count(*) FROM information_schema.tables
WHERE table_schema IN ('iam','catalog','authoring','delivery','grading','learning','analytics','app','audit','outbox');"

echo "== 5/5 清理 =="
psql_in postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DATABASE\";"
echo "恢复演练完成：备份 $((BACKUP_END - BACKUP_START)) 秒，恢复 $((RESTORE_END - RESTORE_START)) 秒。"
