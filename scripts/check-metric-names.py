#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对告警规则与看板引用的指标名。

告警规则引用的指标必须真的被应用导出——引了一个不存在的指标，
规则永远不触发，等于没有这条告警，而且没有任何报错。

这个检查抓到过一批真实缺陷：
  - 规则写的是 http_server_requests_total，应用导出的是 http_requests_total；
  - 规则引用了 db_pool_* 与 npgsql_* ，而 Npgsql 根本没有公开的连接池统计接口；
  - attempt_active_sessions 从来没被 +1 过，规则比的是恒为 0 的数。

用法：
    python3 scripts/check-metric-names.py
退出码非 0 表示有指标对不上。
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 应用侧导出指标名的文件：新增指标类时把文件加进来。
METRIC_SOURCES = [
    "backend/src/Exam.Infrastructure/Observability/ExamMetrics.cs",
    "backend/src/Exam.Infrastructure/Observability/WorkerMetrics.cs",
]

RULES = "deploy/monitoring/prometheus-rules.yml"
DASHBOARD = "deploy/monitoring/grafana/dashboard-exam.json"

# 不是应用导出的指标：来自 node_exporter 与备份任务写出的 textfile。
EXTERNAL_METRICS = {
    "node_filesystem_avail_bytes",
    "node_filesystem_size_bytes",
    "pgbackup_last_run_success",
    "pgbackup_last_run_timestamp_seconds",
    "pgbackup_last_success_timestamp_seconds",
}

# Prometheus 的函数与关键字，不是指标。
PROMETHEUS_KEYWORDS = {
    "absent", "and", "avg", "by", "changes", "clamp_max", "clamp_min", "count",
    "count_values", "day_of_month", "day_of_week", "day_of_year", "delta",
    "deriv", "double_exponential_smoothing", "group", "histogram_quantile",
    "holt_winters", "hour", "idelta", "ignoring", "increase", "irate", "label_replace",
    "last_over_time", "limitk", "limit_ratio", "max", "max_over_time", "min",
    "min_over_time", "minute", "month", "offset", "or", "predict_linear",
    "quantile", "rate", "resets", "round", "scalar", "sort", "sort_by_label",
    "stddev", "stdvar", "sum", "time", "timestamp", "vector", "without", "year",
    "days", "hours", "minutes", "seconds",
}

# 直方图/计数器的派生序列：xxx_bucket / xxx_count / xxx_sum 都来自 xxx。
DERIVED_SUFFIXES = ("_bucket", "_count", "_sum")


def exported_metric_names():
    names = set()
    for rel in METRIC_SOURCES:
        source = (ROOT / rel).read_text(encoding="utf-8")
        names |= set(re.findall(r'Create(?:Counter|Gauge|Histogram|Summary)\(\s*"([^"]+)"', source))
    return names


def extract_exprs(text):
    """从规则文件里抠出每条规则的 expr（含块标量写法）。"""
    exprs = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        match = re.match(r"^(\s*)expr:\s*(.*)$", lines[index])
        if not match:
            index += 1
            continue

        indent = len(match.group(1))
        first = match.group(2).strip()
        index += 1

        if first in ("|", ">", "|-", ">-"):
            block = []
            while index < len(lines):
                line = lines[index]
                if line.strip() and (len(line) - len(line.lstrip())) <= indent:
                    break
                block.append(line)
                index += 1
            exprs.append("\n".join(block))
            continue

        exprs.append(first)
    return exprs


def extract_identifiers(expr):
    """取出表达式里像指标名的标识符。

    标签匹配器（{result="saved"}）与聚合标签（by (le)）里的内容不是指标名，
    先去掉再取标识符。
    """
    stripped = re.sub(r"\{[^{}]*\}", " ", expr)
    stripped = re.sub(r"\b(?:by|without|on|ignoring)\s*\([^)]*\)", " ", stripped)
    identifiers = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", stripped))
    return {i for i in identifiers if i not in PROMETHEUS_KEYWORDS}


def main():
    exported = exported_metric_names()

    referenced = {}

    rules_text = (ROOT / RULES).read_text(encoding="utf-8")
    for expr in extract_exprs(rules_text):
        for name in extract_identifiers(expr):
            referenced.setdefault(name, set()).add("规则")

    dashboard = json.loads((ROOT / DASHBOARD).read_text(encoding="utf-8"))
    for panel in dashboard.get("panels", []):
        for target in panel.get("targets", []) or []:
            expr = target.get("expr", "")
            for name in extract_identifiers(expr):
                referenced.setdefault(name, set()).add(f"看板「{panel.get('title')}」")

    missing = []
    for name, sources in sorted(referenced.items()):
        if name in exported or name in EXTERNAL_METRICS:
            continue

        base = name
        for suffix in DERIVED_SUFFIXES:
            if name.endswith(suffix):
                base = name[: -len(suffix)]
                break

        if base in exported:
            continue

        missing.append((name, sorted(sources)))

    if missing:
        print("告警规则/看板引用了应用没有导出的指标：")
        for name, sources in missing:
            print(f"  - {name}（{', '.join(sources)}）")
        print("要么在应用里补上这个指标，要么改规则。")
        return 1

    print(f"指标名核对通过：规则与看板引用的 {len(referenced)} 个指标名都能对上。")
    print(f"  应用导出 {len(exported)} 个；外部来源 {len(EXTERNAL_METRICS)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
