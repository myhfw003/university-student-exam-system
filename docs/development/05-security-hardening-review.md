# 上线前安全加固复核（T-P9-04）

对应《07-security-compliance.md》§10 的 15 项检查清单。逐项核对实现位置与验证方式；
**没有把握的一项不写成「通过」**，写清楚现状、原因与后续计划。

复核日期：2026-11-15。复核范围：后端（`backend/`）、部署栈（`deploy/`）、CI（`scripts/`）。

| # | 检查项 | 结论 | 依据与说明 |
|---|---|---|---|
| 1 | 全站 HTTPS，HTTP 自动跳转 | ✅ 生产启用 | 默认 compose 栈只监听 80（内网试跑用）；生产用 `deploy/docker-compose.tls.yml` + `deploy/nginx/nginx.tls.conf`：80 只做 301 跳转，业务挂 443 并下发 HSTS。证书挂载与续期步骤见《ops-runbook.md》§1.1。 |
| 2 | 无硬编码密钥入库 | ✅ 通过 | `scripts/scan-secrets.sh` 在 CI 扫描；`appsettings*.json` 只存非敏感默认值，密钥一律环境变量注入（JWT 私钥、数据库口令、对象存储密钥、Redis 口令）。PEM 私钥走 Base64 单行或挂载文件。 |
| 3 | 依赖无高危漏洞 | ✅ 通过 | `dotnet list package --vulnerable --include-transitive` 全项目 0 命中（2026-11-15 实测）；前端 `pnpm audit --prod` 为 0。依赖许可证只允许 Apache-2.0 / MIT / BSD / PostgreSQL。 |
| 4 | SQL 注入防护 | ✅ 通过 | 仓储层只走 EF 参数化查询；**架构测试兜底**：`SqlInjectionGuardTests` 扫描基础设施源码，发现 `FromSqlRaw` / `ExecuteSqlRaw` 拼接字符串即失败。原生命令一律用 `{0}` 占位参数或 `ExecuteSqlRawInterpolated`。 |
| 5 | XSS 防护 | ⚠️ 后端无风险，前端待接线 | 后端只返回 JSON（`application/json`），不渲染 HTML，不存在存储型 XSS 面；富文本净化属于前端渲染层，随前端接线一并处理。 |
| 6 | 越权访问 | ✅ 通过 | 两层校验：Controller 的 `[Authorize(Policy=...)]` + MediatR 管道的 `AuthorizationBehavior`。水平越权由功能测试逐端点验证（成绩报告只看自己的、统计要 `analytics:read`、练习管理要 `practice:write`、错题本按当前用户过滤）。 |
| 7 | 令牌吊销即时生效 | ✅ 通过 | 登出后旧 access token 立即 401（黑名单 + 版本号），集成测试覆盖（`AuthEndpointTests`）。 |
| 8 | Refresh Token 复用检测 | ✅ 通过 | 复用旧 refresh token 触发整族吊销，集成测试覆盖。 |
| 9 | 密码策略与锁定 | ✅ 通过 | PBKDF2 + 盐；失败计数与锁定（`LockoutDuration`）在领域层实现，集成测试覆盖。 |
| 10 | 审计日志完整且不可篡改 | ✅ 通过 | `audit.audit_log` 与 `app.*` 为追加式：部署时 `REVOKE UPDATE, DELETE`（`deploy/db/02-grant-app-role.sql`），应用账号只有 INSERT + SELECT。关键动作有显式审计记录（登录、角色变更、成绩发布、练习上下架等）。 |
| 11 | 附件访问受控 | ✅ 通过 | 附件桶私有，外部只通过短期签名 URL 访问（`ObjectStorage:PresignedUrlSeconds`，默认 300 秒）；过期后签名失效。 |
| 12 | 限流生效 | ✅ 通过 | 全局限流按来源 IP 分区，超限返回 429；**健康检查与 `/metrics` 不参与限流**（探针被限流会把容器判成不健康）。阈值在请求时读配置，改完即生效。功能测试覆盖超限 429 与探针豁免。 |
| 13 | 备份可恢复 | ⏳ 见 T-P9-05 | 备份方案与恢复脚本见《ops-runbook.md》§6；**季度恢复演练的实测记录**在 T-P9-05 交付后补齐。 |
| 14 | 日志无敏感信息 | ✅ 通过 | 日志只记 ID 与计数，不记答案内容与口令；认证失败只记用户名与原因。审计摘要同样不含敏感值。 |
| 15 | 错误响应不泄露内部细节 | ✅ 通过 | 统一异常中间件输出 ProblemDetails（错误码 + 中文说明 + TraceId）；**生产环境不返回异常类型与消息**，只有开发环境才带细节。堆栈只进服务端日志。 |

## 本轮补上的加固

1. **SQL 注入架构测试**（`tests/Exam.ArchitectureTests/SqlInjectionGuardTests.cs`）：把「代码审查禁止拼接 SQL」变成 CI 强制。
2. **探针豁免限流**：健康检查与指标不再参与限流，避免高负载时容器被误判不健康。
3. **限流阈值请求时读取**：不再在启动时读死，改配置即生效，测试宿主覆盖配置也能生效。
4. **全站 HTTPS 配置**：`deploy/nginx/nginx.tls.conf` + `deploy/docker-compose.tls.yml`，80 只做跳转。
5. **依赖漏洞扫描实测**：全项目 0 命中，记录在案。

## 遗留与例外

| 项 | 现状 | 计划 |
|---|---|---|
| 第 5 项 XSS | 后端无风险；前端富文本净化未做 | 随前端接线完成（前端阶段） |
| 第 13 项 备份恢复 | 脚本与流程齐备，**缺实测演练记录** | T-P9-05 交付：完成一次恢复到临时实例并校验数据 |
| TLS 证书自动化续期 | 手工换证书 + `nginx -s reload` | 生产接入学校统一证书服务后改为自动续期 |
