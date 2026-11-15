#!/bin/sh
# 备份定时任务。
#
# 职责：
#   1. 启动时先做一次基线全量（没有基线，后续差异备份无处可依）；
#   2. 每天 02:00 做一次全量备份；
#   3. 每天 03:00 做一次差异备份；
#   4. 每周一 04:00 做过期清理（expire），把超出保留策略的备份删掉。
#
# WAL 归档由数据库侧的 archive_command 推送（见 compose 的 postgres 服务），
# 这里不重复推——推两次会打断归档链。
set -eu

STANZA="${STANZA:-db}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 等数据库就绪
until pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "${PGUSER:-exam_owner}" >/dev/null 2>&1; do
    log "等待数据库就绪……"
    sleep 5
done

log "开始基线全量备份。"
pgbackrest --stanza="$STANZA" --type=backup backup
log "基线全量备份完成。"

while true; do
    now="$(date '+%H%M')"
    weekday="$(date '+%u')"

    if [ "$now" = "0200" ]; then
        log "每日全量备份。"
        pgbackrest --stanza="$STANZA" --type=backup backup || log "全量备份失败，下一轮重试。"
    elif [ "$now" = "0300" ]; then
        log "每日差异备份。"
        pgbackrest --stanza="$STANZA" --type=diff backup || log "差异备份失败，下一轮重试。"
    elif [ "$now" = "0400" ] && [ "$weekday" = "1" ]; then
        log "过期清理。"
        pgbackrest --stanza="$STANZA" expire || log "过期清理失败，下一轮重试。"
    fi

    sleep 60
done
