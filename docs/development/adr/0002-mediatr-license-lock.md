# ADR-002：锁定 MediatR 12.x（Apache-2.0）

**状态**：已接受　**日期**：2026-11-12

## 背景

项目要求 MediatR 作为 CQRS 管线。MediatR 自 v13 起改为商业授权（需付费购买商业许可），
而 v12 及更早版本为 Apache-2.0。这是一个**授权红线**问题，不是技术偏好问题——
项目的依赖准入规则是「只允许 Apache-2.0 / MIT / BSD / PostgreSQL License」。

## 候选方案

| 方案 | 结论 |
|---|---|
| MediatR 13/14（最新） | ❌ 商业授权，不符合准入规则 |
| MediatR 12.4.1 | ✅ Apache-2.0，包内已内置 `AddMediatR`，无需额外 DI 扩展包 |
| Wolverine | ❌ 生态与中文资料较少，且本项目只需要简单的 Command/Query + 管道 |
| 自研 CQRS 管线 | ❌ 收益不抵自研成本，管道行为（校验/鉴权/事务/日志）是通用能力 |

## 决策

锁定 **MediatR 12.4.1**。中央包版本在 `backend/Directory.Packages.props` 统一管理，
后续升级需重新核对 nuget 包内的授权声明。

## 代价与后果

- 停留在 12.x 意味着无法使用 v13+ 的新特性。
- 需在 CI 中保留依赖漏洞扫描与授权核对流程。
- **注意**：MediatR v12 的 DI 扩展曾短暂拆分为独立包
  `MediatR.Extensions.Microsoft.DependencyInjection`（该包最高只到 11.1.0）。
  实测确认 **v12 核心包已内置 `ServiceCollectionExtensions.AddMediatR`**，无需该扩展包。

## 验证

```bash
grep -o '<license type="expression">[^<]*' \
  ~/.nuget/packages/mediatr/12.4.1/mediatr.nuspec
# => <license type="expression">Apache-2.0
```
