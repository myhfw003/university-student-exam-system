# -*- coding: utf-8 -*-
"""生成 promtool 单元测试文件。

promtool 要求告警的**标签集和注解集完全一致**，因此这里把每条规则的
期望标签、期望注解都写死。注解里的模板值（{{ $value }} 等）在
测试输入确定后是固定的，直接照实际渲染结果写。

用法（在 deploy/monitoring 目录下）：
    python3 gen-rules-test.py
    docker run --rm --entrypoint /bin/promtool -v "$PWD:/w" -w /w \
      prom/prometheus:v2.54.1 test rules prometheus-rules.test.yml
"""

# 规则名 -> (期望标签, 期望注解)
ALERTS = {
    "ExamAnswerSaveErrorRateHigh": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: 答卷保存错误率超过 1%",
            "description: 最近 5 分钟整批保存被拒占比 4.762%，先查数据库连接池、限流与 PG 负载。",
        ],
    },
    "ExamAnswerSaveP95High": {
        "labels": ["severity: P2"],
        "annotations": [
            "summary: 答卷保存 p95 超过 500ms",
            "description: 当前 p95 1s，处置入口见《ops-runbook.md》§4.2。",
        ],
    },
    "ExamAnswerLostSuspected": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: 答卷丢失疑似（对账发现序列号缺口）",
            "description: 对账作业发现 20 处差异：会话说收到了、库里没有。立即人工核查，必要时暂停相关场次。",
        ],
    },
    "ExamActiveSessionsDropped": {
        "labels": ["severity: P1", "examSessionId: 1"],
        "annotations": [
            "summary: 活跃会话数骤降",
            "description: 场次 1 的活跃会话数相对 15 分钟峰值下降超过 30%，先查网关、负载均衡与前端报错。",
        ],
    },
    "ExamFocusEventsSpiking": {
        "labels": ["severity: P2"],
        "annotations": [
            "summary: 切屏事件激增",
            "description: 平均每秒超过 50 次切屏，可能是监考处置或客户端异常。",
        ],
    },
    "ExamOutboxBacklog": {
        "labels": ["severity: P2"],
        "annotations": [
            "summary: Outbox 积压超过 1000 条",
            "description: 待派发 1500 条，检查 Worker 进程是否存活。",
        ],
    },
    "ExamBackgroundJobFailed": {
        "labels": ["severity: P2", "job: statistics"],
        "annotations": [
            "summary: 后台作业失败",
            "description: 最近 30 分钟有后台作业失败，查 Worker 日志。",
        ],
    },
    "ExamBackgroundJobSlow": {
        "labels": ["severity: P2", "job: statistics"],
        "annotations": [
            "summary: 后台作业耗时过长",
            "description: 作业 statistics 的 p95 超过 300 秒。",
        ],
    },
    "ExamDatabaseConnectionsExhausted": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: 数据库连接接近耗尽",
            "description: 可用连接 2 条，低于上限的 10%，查连接泄漏与慢查询，处置入口见《ops-runbook.md》§4.6。",
        ],
    },
    "ExamDiskUsageHigh": {
        "labels": ["severity: P2", "mountpoint: /"],
        "annotations": [
            "summary: 磁盘使用超过 80%",
            "description: 挂载点 / 剩余不足 20%，清理或扩容。",
        ],
    },
    "ExamBackupFailed": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: 备份失败或从未执行",
            "description: 最近一次备份失败，或备份任务从未留下成功记录；立即人工核查并重跑。",
        ],
    },
    "ExamBackupStale": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: 超过 26 小时没有成功备份",
            "description: 最近一次成功备份距今已超过 26 小时；查备份任务、归档目录与 WAL 归档链路。",
        ],
    },
    "ExamClockOffsetHigh": {
        "labels": ["severity: P2"],
        "annotations": [
            "summary: 应用时钟与数据库时钟偏差超过 50ms",
            "description: 实例  偏差 120 毫秒，查宿主机 NTP 与容器时区。",
        ],
    },
    "ExamRedisUnavailable": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: Redis 不可用",
            "description: Redis 探测失败持续 1 分钟以上：权限缓存与令牌吊销名单降级为进程内，作答路径仍可用。",
        ],
    },
    "ExamHttpErrorRateHigh": {
        "labels": ["severity: P1"],
        "annotations": [
            "summary: HTTP 5xx 比例超过 0.1%",
            "description: 最近 5 分钟 5xx 占比 1.099%，先查最近的发布与数据库负载。",
        ],
    },
    "ExamRedisCommandSlow": {
        "labels": ["severity: P2", "op: permission_get"],
        "annotations": [
            "summary: Redis 命令 p95 超过 50ms",
            "description: 操作 permission_get 的 p95 超过 50 毫秒，查 Redis 自身负载与网络。",
        ],
    },
}

EVAL_TIME = {}


def emit_alert(name, indent="      "):
    spec = ALERTS[name]
    lines = [f"{indent}- eval_time: {EVAL_TIME[name]}",
             f"{indent}  alertname: {name}",
             f"{indent}  exp_alerts:",
             f"{indent}    - exp_labels:"]
    lines.append(f"{indent}        alertname: {name}")
    for label in spec["labels"]:
        lines.append(f"{indent}        {label}")
    lines.append(f"{indent}      exp_annotations:")
    for annotation in spec["annotations"]:
        lines.append(f"{indent}        {annotation}")
    return "\n".join(lines)


def emit_no_alert(name, indent="      "):
    return (f"{indent}- eval_time: {EVAL_TIME[name]}\n"
            f"{indent}  alertname: {name}\n"
            f"{indent}  exp_alerts: []")


def block(name, series, eval_time, alert=None, no_alert=None):
    EVAL_TIME[alert or no_alert] = eval_time
    out = [f"  - name: {name}", "    interval: 1m", "    input_series:"]
    for s in series:
        out.append(f"      - series: '{s[0]}'")
        out.append(f"        values: '{s[1]}'")
    out.append("    alert_rule_test:")
    if alert:
        out.append(emit_alert(alert))
    if no_alert:
        out.append(emit_no_alert(no_alert))
    return "\n".join(out)


HEADER = """# 告警规则的单元测试（promtool test rules）。
#
# 验收口径（对应 T-P9-06 的「人为制造异常能触发预期告警」）：
# 每条规则都有正反两组用例——造出越界的指标序列，断言告警按预期 firing；
# 一切正常时，断言不 firing。
#
# 跑法（在 deploy/monitoring 目录下）：
#   docker run --rm --entrypoint /bin/promtool -v "$PWD:/w" -w /w \\
#     prom/prometheus:v2.54.1 test rules prometheus-rules.test.yml
#
# 本文件由 gen-rules-test.py 维护，改规则时同步改这里的期望值。
rule_files:
  - prometheus-rules.yml

evaluation_interval: 1m

tests:
"""

blocks = []

# ---- 作答链路 ----
blocks.append(block(
    "答卷保存错误率超标应触发",
    [('attempt_answers_saved_total{result="saved"}', "0+100x20"),
     ('attempt_answers_saved_total{result="rejected"}', "0+5x20")],
    "10m", alert="ExamAnswerSaveErrorRateHigh"))

blocks.append(block(
    "答卷保存错误率正常不应触发",
    [('attempt_answers_saved_total{result="saved"}', "0+100x20"),
     ('attempt_answers_saved_total{result="rejected"}', "0x20")],
    "10m", no_alert="ExamAnswerSaveErrorRateHigh"))

blocks.append(block(
    "答卷保存变慢应触发",
    [('attempt_answers_saved_duration_seconds_bucket{le="0.1"}', "0+1x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="0.5"}', "0+1x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="1"}', "0+1x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="+Inf"}', "0+100x20")],
    "10m", alert="ExamAnswerSaveP95High"))

blocks.append(block(
    "答卷保存速度正常不应触发",
    [('attempt_answers_saved_duration_seconds_bucket{le="0.1"}', "0+100x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="0.5"}', "0+100x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="1"}', "0+100x20"),
     ('attempt_answers_saved_duration_seconds_bucket{le="+Inf"}', "0+100x20")],
    "10m", no_alert="ExamAnswerSaveP95High"))

blocks.append(block(
    "对账发现答卷差异应触发",
    [('answer_reconciliation_findings_total', "0+2x20")],
    "10m", alert="ExamAnswerLostSuspected"))

blocks.append(block(
    "对账无差异不应触发",
    [('answer_reconciliation_findings_total', "0x20")],
    "10m", no_alert="ExamAnswerLostSuspected"))

blocks.append(block(
    "活跃会话骤降应触发",
    [('attempt_active_sessions{examSessionId="1"}', "100x12 10x20")],
    "20m", alert="ExamActiveSessionsDropped"))

blocks.append(block(
    "活跃会话平稳不应触发",
    [('attempt_active_sessions{examSessionId="1"}', "100x30")],
    "20m", no_alert="ExamActiveSessionsDropped"))

blocks.append(block(
    "切屏激增应触发",
    [('attempt_focus_events_total{type="blur"}', "0+4000x30")],
    "20m", alert="ExamFocusEventsSpiking"))

blocks.append(block(
    "切屏正常不应触发",
    [('attempt_focus_events_total{type="blur"}', "0+10x30")],
    "20m", no_alert="ExamFocusEventsSpiking"))

# ---- 容量与后台作业 ----
blocks.append(block(
    "Outbox 积压应触发",
    [('outbox_pending_messages', "1500x20")],
    "10m", alert="ExamOutboxBacklog"))

blocks.append(block(
    "Outbox 无积压不应触发",
    [('outbox_pending_messages', "0x20")],
    "10m", no_alert="ExamOutboxBacklog"))

blocks.append(block(
    "后台作业失败应触发",
    [('background_job_failures_total{job="statistics"}', "0+1x20")],
    "10m", alert="ExamBackgroundJobFailed"))

blocks.append(block(
    "后台作业无失败不应触发",
    [('background_job_failures_total{job="statistics"}', "0x20")],
    "10m", no_alert="ExamBackgroundJobFailed"))

blocks.append(block(
    "后台作业变慢应触发",
    [('background_job_duration_seconds_bucket{job="statistics",le="10"}', "0+1x40"),
     ('background_job_duration_seconds_bucket{job="statistics",le="300"}', "0+1x40"),
     ('background_job_duration_seconds_bucket{job="statistics",le="600"}', "0+1x40"),
     ('background_job_duration_seconds_bucket{job="statistics",le="+Inf"}', "0+10x40")],
    "40m", alert="ExamBackgroundJobSlow"))

blocks.append(block(
    "数据库可用连接不足应触发",
    [('db_pool_active_connections', "198x20"),
     ('db_pool_max_connections', "200x20"),
     ('db_pool_available_connections', "2x20")],
    "10m", alert="ExamDatabaseConnectionsExhausted"))

blocks.append(block(
    "数据库可用连接充足不应触发",
    [('db_pool_active_connections', "20x20"),
     ('db_pool_max_connections', "200x20"),
     ('db_pool_available_connections', "60x20")],
    "10m", no_alert="ExamDatabaseConnectionsExhausted"))

blocks.append(block(
    "磁盘使用率过高应触发",
    [('node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"}', "10x20"),
     ('node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"}', "100x20")],
    "10m", alert="ExamDiskUsageHigh"))

blocks.append(block(
    "磁盘充足不应触发",
    [('node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"}', "50x20"),
     ('node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"}', "100x20")],
    "10m", no_alert="ExamDiskUsageHigh"))

# ---- 备份 ----
blocks.append(block(
    "备份失败应触发",
    [('pgbackup_last_run_success', "0x20")],
    "10m", alert="ExamBackupFailed"))

blocks.append(block(
    "备份成功不应触发",
    [('pgbackup_last_run_success', "1x20")],
    "10m", no_alert="ExamBackupFailed"))

blocks.append(block(
    "备份任务从未跑过应触发",
    [],
    "10m", alert="ExamBackupFailed"))

blocks.append(block(
    "超过 26 小时没有成功备份应触发",
    # 单元测试的时间轴从 0 开始，负时间戳表示「很久以前」。
    [('pgbackup_last_success_timestamp_seconds', "-93700x20")],
    "10m", alert="ExamBackupStale"))

blocks.append(block(
    "刚成功备份过不应触发",
    [('pgbackup_last_success_timestamp_seconds', "600x20")],
    "10m", no_alert="ExamBackupStale"))

# ---- 时钟与 Redis ----
blocks.append(block(
    "时钟偏移超限应触发",
    [('clock_offset_ms', "120x20")],
    "10m", alert="ExamClockOffsetHigh"))

blocks.append(block(
    "时钟偏移正常不应触发",
    [('clock_offset_ms', "10x20")],
    "10m", no_alert="ExamClockOffsetHigh"))

blocks.append(block(
    "Redis 不可用应触发",
    [('redis_up', "0x20")],
    "10m", alert="ExamRedisUnavailable"))

blocks.append(block(
    "Redis 可用不应触发",
    [('redis_up', "1x20")],
    "10m", no_alert="ExamRedisUnavailable"))

blocks.append(block(
    "Redis 命令变慢应触发",
    [('redis_command_duration_seconds_bucket{op="permission_get",le="0.01"}', "0+1x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="0.05"}', "0+1x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="0.1"}', "0+10x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="+Inf"}', "0+20x30")],
    "20m", alert="ExamRedisCommandSlow"))

blocks.append(block(
    "Redis 命令正常不应触发",
    [('redis_command_duration_seconds_bucket{op="permission_get",le="0.01"}', "0+100x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="0.05"}', "0+100x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="0.1"}', "0+100x30"),
     ('redis_command_duration_seconds_bucket{op="permission_get",le="+Inf"}', "0+100x30")],
    "20m", no_alert="ExamRedisCommandSlow"))

# ---- 应用层 ----
blocks.append(block(
    "HTTP 5xx 比例超标应触发",
    [('http_requests_total{status="200"}', "0+900x20"),
     ('http_requests_total{status="500"}', "0+10x20")],
    "10m", alert="ExamHttpErrorRateHigh"))

blocks.append(block(
    "HTTP 无 5xx 不应触发",
    [('http_requests_total{status="200"}', "0+900x20")],
    "10m", no_alert="ExamHttpErrorRateHigh"))

with open("prometheus-rules.test.yml", "w", encoding="utf-8") as handle:
    handle.write(HEADER + "\n".join(blocks) + "\n")

print("generated")
