# 知行测评 · 考试平台 文档索引

## 给使用者

| 文档 | 读者 | 内容 |
|---|---|---|
| [学生手册](guide/student-manual.md) | 考生 | 登录、答题、交卷、成绩、练习、错题本、常见问题 |
| [教师手册](guide/teacher-manual.md) | 教师 / 阅卷 / 考务 | 题库、组卷、场次、监考、阅卷、成绩发布、审计 |
| [运维手册](development/ops-runbook.md) | 技术值班 | 部署、常见故障、告警处置、值班手册、告警演练 |
| [API 文档](api/README.md) | 前端 / 第三方对接 | 通用约定、认证、端点清单、前端对接要点；契约见 `api/openapi.json` |

## 给开发者

| 文档 | 内容 |
|---|---|
| [设计文档](design/00-overview.md) | 需求、架构、领域模型、数据模型、API、前端、安全、部署运维 |
| [任务拆解](development/01-task-breakdown.md) | 阶段计划、每个任务的交付说明与完成状态 |
| [开发约定](development/02-conventions.md) | 命名、分层、依赖、提交与文档规范 |
| [架构决策记录](development/adr/README.md) | 18 条 ADR：背景、候选方案、结论、代价 |
| [前端一致性复核](development/04-frontend-parity-review.md) | 前端与设计文档的差异清单 |
| [安全加固复核](development/05-security-hardening-review.md) | 《07-security-compliance.md》§10 的 15 项清单逐条复核 |
| [备份与恢复演练记录](development/06-backup-restore-drill.md) | 季度演练：备份 → 恢复到临时实例 → 逐表校验 |
| [告警演练记录](development/07-alert-drill.md) | 规则级（promtool）与环境级（真实监控栈）演练结果 |

## 目录结构

```
docs/
├── design/      设计文档（00 需求总览 ~ 08 部署运维）
├── guide/       使用者手册（学生、教师）
├── api/         API 文档与 OpenAPI 契约
└── development/ 开发文档（计划、约定、ADR、复核与演练记录）
```

## 常用入口

```bash
# 重新导出 OpenAPI 契约
bash scripts/export-openapi.sh

# 告警规则与指标名核对
cd deploy/monitoring && python3 ../../scripts/check-metric-names.py
docker run --rm --entrypoint /bin/promtool -v "$PWD:/w" -w /w \
  prom/prometheus:v2.54.1 test rules prometheus-rules.test.yml
```
