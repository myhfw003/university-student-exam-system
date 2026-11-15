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

# 备份状态指标目录。node_exporter 的 textfile 采集器会读这里的 *.prom，
# 备份任务自己报自己的状态：备份失败了不能等人工去看日志才发现。
METRICS_DIR="${METRICS_DIR:-/backup-metrics}"
METRICS_FILE="${METRICS_DIR}/backup.prom"
STATE_FILE="${METRICS_DIR}/last_success_timestamp"

publish_metrics() {
    # $1：本次备份是否成功（1/0）
    run_success="$1"
    now="$(date +%s)"
    last_success="$(cat "${STATE_FILE}" 2>/dev/null || echo 0)"

    {
        echo "# HELP pgbackup_last_run_timestamp_seconds 最近一次备份任务的执行时刻（Unix 秒）"
        echo "# TYPE pgbackup_last_run_timestamp_seconds gauge"
        echo "pgbackup_last_run_timestamp_seconds ${now}"
        echo "# HELP pgbackup_last_run_success 最近一次备份任务是否成功（1 成功 / 0 失败）"
        echo "# TYPE pgbackup_last_run_success gauge"
        echo "pgbackup_last_run_success ${run_success}"
        echo "# HELP pgbackup_last_success_timestamp_seconds 最近一次成功备份的时刻（Unix 秒）"
        echo "# TYPE pgbackup_last_success_timestamp_seconds gauge"
        echo "pgbackup_last_success_timestamp_seconds ${last_success}"
    } > "${METRICS_FILE}.tmp"

    mv "${METRICS_FILE}.tmp" "${METRICS_FILE}"
}

save_success() {
    date +%s > "${STATE_FILE}"
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 等数据库就绪
until pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "${PGUSER:-exam_owner}" >/dev/null 2>&1; do
    log "等待数据库就绪……"
    sleep 5
done

log "开始基线全量备份。"
if pgbackrest --stanza="$STANZA" --type=backup backup; then
    save_success
    publish_metrics 1
    log "基线全量备份完成。"
else
    publish_metrics 0
    log "基线全量备份失败。"
    exit 1
fi

while true; do
    now="$(date '+%H%M')"
    weekday="$(date '+%u')"

    if [ "$now" = "0200" ]; then
        log "每日全量备份。"
        if pgbackrest --stanza="$STANZA" --type=backup backup; then
            save_success
            publish_metrics 1
        else
            publish_metrics 0
            log "全量备份失败，下一轮重试。"
        fi
    elif [ "$now" = "0300" ]; then
        log "每日差异备份。"
        if pgbackrest --stanza="$STANZA" --type=diff backup; then
            save_success
            publish_metrics 1
        else
            publish_metrics 0
            log "差异备份失败，下一轮重试。"
        fi
    elif [ "$now" = "0400" ] && [ "$weekday" = "1" ]; then
        log "过期清理。"
        if pgbackrest --stanza="$STANZA" expire; then
            publish_metrics 1
        else
            publish_metrics 0
            log "过期清理失败，下一轮重试。"
        fi
    fi

    sleep 60
done
