#!/usr/bin/env bash
# 告警演练脚本。
#
# 目的：确认「人为制造的异常能触发预期告警」，而且恢复后告警能自己消掉。
# 没演练过的告警等于没有告警——规则写对了不代表表达式里的指标真的存在、真的有值。
#
# 用法（在 deploy/monitoring 目录下）：
#   ./drill-alerts.sh redis        # 停 Redis，看 ExamRedisUnavailable 是否 firing
#   ./drill-alerts.sh redis-check  # 只看当前有没有 firing 的告警
#
# 前置条件：监控栈已启动（docker compose --profile monitoring up -d），
# 且 api/worker 是带指标的版本（否则 redis_up 这个指标根本不存在）。
set -uo pipefail

# compose 文件在 deploy/ 下，脚本在 deploy/monitoring/ 下。
cd "$(dirname "$0")/.."

# compose 里 grafana 服务要求这个变量；演练用不到 grafana，兜个假值即可。
export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-drill-only}"

ALERTMANAGER="http://alertmanager:9093"
# 用 prometheus 容器里的 wget 访问 alertmanager：指标端口不对宿主机发布。
am_api() {
    docker compose exec -T prometheus wget -qO- "$ALERTMANAGER$1" 2>/dev/null
}

# 列出 firing 的告警名
firing_alerts() {
    am_api /api/v2/alerts | python3 -c "
import json, sys
try:
    alerts = json.load(sys.stdin)
except Exception:
    alerts = []
for a in alerts:
    labels = a.get('labels', {})
    if a.get('status', {}).get('state') == 'active':
        print(labels.get('alertname', '?'), labels.get('severity', '?'))
"
}

# 等待某个告警进入 firing，最多等 timeout 秒
wait_firing() {
    name="$1"
    timeout="${2:-180}"
    waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if firing_alerts | grep -q "^${name} "; then
            echo "  ✓ ${name} 已 firing（等待 ${waited}s）"
            return 0
        fi
        sleep 10
        waited=$((waited + 10))
    done
    echo "  ✗ ${name} 在 ${timeout}s 内没有 firing"
    firing_alerts
    return 1
}

# 等待某个告警全部 resolved，最多等 timeout 秒
wait_resolved() {
    name="$1"
    timeout="${2:-180}"
    waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if ! firing_alerts | grep -q "^${name} "; then
            echo "  ✓ ${name} 已消警（等待 ${waited}s）"
            return 0
        fi
        sleep 10
        waited=$((waited + 10))
    done
    echo "  ✗ ${name} 在 ${timeout}s 内没有消警"
    firing_alerts
    return 1
}

case "${1:-}" in
    redis)
        echo "演练：Redis 不可用 → ExamRedisUnavailable"
        echo "1) 停掉 Redis（作答路径应仍可用，权限缓存降级为进程内）"
        docker compose stop redis
        echo "2) 等告警 firing（规则要求持续 1 分钟）"
        wait_firing ExamRedisUnavailable 180
        result=$?
        echo "3) 恢复 Redis"
        docker compose start redis
        echo "4) 等告警自己消警"
        wait_resolved ExamRedisUnavailable 180
        exit $result
        ;;
    redis-check)
        echo "当前 firing 的告警："
        firing_alerts
        ;;
    *)
        echo "用法：$0 {redis|redis-check}"
        exit 2
        ;;
esac
