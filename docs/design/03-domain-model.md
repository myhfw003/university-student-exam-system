# 03 · 领域模型设计

> 关联：`00-overview.md`（统一语言）、`02-architecture.md`（限界上下文）
> 本文档是编码的直接依据。领域层零外部依赖，所有规则以领域方法表达并被单元测试锁定。

---

## 1. 建模约定

### 1.1 聚合划分原则

1. 一个聚合根是**一致性边界**：事务内被整体保护。
2. 聚合之间用**标识**引用（存 ID，不存对象引用）。
3. 聚合根拥有自己的仓储；其他实体通过聚合根访问，不单独建仓储。
4. 跨聚合的最终一致性用**领域事件 + Outbox** 表达。

### 1.2 实体与值对象

| 判定 | 适用 |
|---|---|
| 实体 | 有独立标识、生命周期与可变状态（题目、试卷、会话） |
| 值对象 | 无标识、由属性定义、不可变（分值、时间窗、标签代码、权限码） |

值对象不可变，变更即整体替换（如 `Score` 从 5 改为 6 是替换而非修改）。

### 1.3 基础类型

```csharp
// 标识：使用强类型 record struct，防止把 QuestionId 传给 PaperId
public readonly record struct QuestionId(long Value);
public readonly record struct PaperId(long Value);
public readonly record struct AttemptId(long Value);
public readonly record struct UserId(long Value);
public readonly record struct TagId(long Value);
```

### 1.4 基础实体

```csharp
public abstract class Entity<TId> where TId : struct
{
    public TId Id { get; protected set; }
}

public abstract class AggregateRoot<TId> : Entity<TId>
{
    private readonly List<IDomainEvent> _domainEvents = [];
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();
    protected void AddDomainEvent(IDomainEvent e) => _domainEvents.Add(e);
    public void ClearDomainEvents() => _domainEvents.Clear();
}

public abstract class AuditableEntity : AggregateRoot<long>
{
    public DateTimeOffset CreatedAt { get; protected set; }
    public string CreatedBy { get; protected set; }
    public DateTimeOffset? UpdatedAt { get; protected set; }
    public string? UpdatedBy { get; protected set; }
    public DateTimeOffset? DeletedAt { get; protected set; }
    public bool IsDeleted => DeletedAt.HasValue;
}
```

### 1.5 值对象基类

```csharp
public abstract record ValueObject
{
    protected abstract IEnumerable<object?> GetEqualityComponents();
    public override bool Equals(object? obj) =>
        obj is ValueObject other &&
        GetEqualityComponents().SequenceEqual(other.GetEqualityComponents());
    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var c in GetEqualityComponents()) hash.Add(c);
        return hash.ToHashCode();
    }
}
```

---

## 2. Identity & Access 上下文

### 2.1 User（用户）聚合根

| 属性 | 类型 | 约束 |
|---|---|---|
| `Id` | `UserId` | 标识 |
| `Username` | `string` | 登录账号，全局唯一（大小写不敏感），4..32 位，允许字母、数字、下划线、点、中划线。学生可用学号，社会人士自选 |
| `DisplayName` | `string` | 姓名，1..64 |
| `PasswordHash` | `string` | PBKDF2 哈希，不可逆 |
| `Email` | `string?` | 唯一（可空） |
| `Phone` | `string?` | 脱敏存储/展示 |
| `Status` | `UserStatus` | `Active` / `Locked` / `Disabled` |
| `TagIds` | `TagId[]` | 挂载的组织维度标签，**可选**（社会人士不挂任何组织标签） |
| `LastLoginAt` | `DateTimeOffset?` | |
| `FailedLoginCount` | `int` | 连续失败计数 |
| `LockedUntil` | `DateTimeOffset?` | 锁定截止 |

**领域方法**

| 方法 | 规则 |
|---|---|
| `Register(...)` | 校验用户名唯一性由仓储保证；初始状态 `Active` |
| `Authenticate(password, hashVerifier, clock)` | 密码错误 → `FailedLoginCount++`；达到 5 次 → `Locked` 15 分钟；成功 → 清零、记录 `LastLoginAt`、刷新密码哈希（`rehashNeeded` 标记） |
| `ChangePassword(old, new, verifier)` | 旧密码必须匹配；新密码强度校验（≥8 位且含字母与数字） |
| `ResetPassword(new, verifier)` | 管理员路径，置 `MustChangePassword` |
| `AssignTags(tagIds)` | 变更组织标签（只接受组织维度标签） |
| `Enable()` / `Disable(reason)` | 禁用时发出 `UserDisabled` 事件，令牌吊销由事件处理方完成 |

**值对象 `PasswordPolicy`**：静态校验，返回违规项清单。

### 2.2 Role（角色）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `RoleId` |
| `Code` | `system_admin` / `content_admin` / `author_teacher` / `grader_teacher` / `student`（在校学生）/ `general_user`（社会人士），唯一 |
| `Name` | 显示名 |
| `Description` | |
| `IsSystem` | 系统内置角色不可删除，只能调整权限 |
| `PermissionCodes` | 权限码集合（值对象 `PermissionCode`） |

**值对象 `PermissionCode`**：格式 `模块:动作`，如 `paper:publish`。由 `PermissionCatalog` 提供全量常量，防止拼写错误。

### 2.3 Permission（权限）

| 属性 | 说明 |
|---|---|
| `Code` | `模块:动作`，唯一 |
| `Name` | 显示名 |
| `Module` | 所属模块（question/tag/bank/paper/exam/attempt/review/grade/proctor/user/role/analytics/audit/system） |
| `Description` | |

### 2.4 组织归属：组织维度标签

不设独立的组织聚合。院系 / 专业 / 班级统一表达为**组织维度标签**（`Tag.Group = TagGroup.Organization`），在 Catalog 上下文的 `Tag` 聚合内成树。

| 层级 | 表达方式 | 示例 |
|---|---|---|
| 学院 | 组织维度标签，父为空 | `计算机学院` |
| 专业 | 组织维度标签，父为学院标签 | `计算机科学与技术` |
| 班级 | 组织维度标签，父为专业标签 | `计科 2301 班` |

| 关注点 | 规则 |
|---|---|
| 用户归属 | `iam.user_tag` 关联表（用户 ↔ 组织维度标签）。学生挂班级标签即隐含其上级 |
| 查询所属组织 | 取用户挂载的最深组织标签，沿 `parent_id` 上溯得到完整路径（`TagPathResolver`），**不单独存字段** |
| 名单范围 | 考试场次与练习开放单保存**组织标签 ID 数组**；发布时按标签（含子标签）展开为考生名单并物化 |
| 删除规则 | 有子标签或已关联用户时拒绝删除并说明原因（复用 `Tag.EnsureDeletable`） |
| 自动创建 | 导入学生名单时，若 CSV 中的院系 / 专业 / 班级无对应标签，**自动创建**并按层级挂接（`Tag.EnsureOrganizationTag(pathSegments)`） |

### 2.5 RefreshToken（刷新令牌）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `RefreshTokenId` |
| `UserId` | 所属用户 |
| `TokenHash` | 令牌哈希（不存明文） |
| `FamilyId` | 令牌族 ID；轮换时保持不变，复用检测时整族吊销 |
| `ExpiresAt` | 过期时间 |
| `RevokedAt` | 吊销时间 |
| `ReplacedByTokenId` | 轮换后的新令牌 |
| `CreatedByIp` / `UserAgent` | 审计 |
| `RevokeReason` | `rotated` / `logout` / `reuse_detected` / `password_changed` / `user_disabled` |

**领域方法**：`Rotate(newTokenHash, now)`、`Revoke(reason, now)`、`IsExpired(now)`、`IsActive(now)`。

---

## 3. Catalog 上下文

### 3.1 Tag（标签）聚合根

| 属性 | 类型 | 说明 |
|---|---|---|
| `Id` | `TagId` | |
| `Code` | `string` | 唯一稳定编码（如 `math.calculus.limit`），用于导入与 API 引用 |
| `Name` | `string` | 显示名，1..50 |
| `Group` | `TagGroup` | 枚举：`Domain` / `KnowledgePoint` / `Ability` / `Difficulty` / `Organization` |
| `ParentId` | `TagId?` | 父标签；难度维度禁止有父；组织维度只挂组织维度的父；内容维度（领域 / 知识点 / 能力）之间可跨维度（ADR-020） |
| `Level` | `int?` | **仅难度维度**有值，范围 1..5；其他维度为 null |
| `Description` | `string?` | |
| `SortOrder` | `int` | |
| `IsSystem` | `bool` | 系统预置标签（如 3 个基础难度）不可删除 |
| `UsageCount` | `int` | 冗余计数，由引用变更时同步（领域行为维护） |

**领域方法**

| 方法 | 规则 |
|---|---|
| `Create(...)` | 校验 Group 合法；难度维度必须给 `Level` 且 1..5；其他维度必须 `Level == null`；难度维度禁止有父；组织维度标签的父必须是组织维度标签；内容维度之间可跨维度成树（`TagGroups.CanNest`，ADR-020） |
| `Rename(name)` | |
| `ReassignParent(parentId)` | 父节点必须同维度；禁止自引用；禁止形成环（由应用层校验可达性） |
| `SetLevel(level)` | 仅难度维度可调用 |
| `EnsureDeletable(usedByPublishedBlueprint)` | 被已发布组卷方案引用时拒绝删除 |
| `IncrementUsage()` / `DecrementUsage()` | 计数不得为负 |

**值对象 `TagGroup`**：枚举 + 中文标签映射 + `AllowsHierarchy`（难度维度不允许）+ `AppliesTo`（题目 / 用户 / 两者）。`Organization` 维度只适用于用户。

**值对象 `TagSelector`**：一次筛选条件，含标签 ID 集合、`IncludeDescendants`（默认 true）、`MatchMode`（`Any` / `All`）。

### 3.2 Question（题目）聚合根

| 属性 | 类型 | 说明 |
|---|---|---|
| `Id` | `QuestionId` | |
| `Code` | `string` | 题号，全局唯一，如 `Q-2026-000123` |
| `Type` | `QuestionType` | `Single` / `Multi` / `Judge` / `Short` / `Comprehensive` |
| `Stem` | `string` | 题干（Markdown + 附件引用），必填 |
| `DefaultScore` | `Score` | 默认分值，1..40 |
| `Status` | `QuestionStatus` | `Draft` / `Published` / `Disabled` |
| `Source` | `QuestionSource` | `Manual` / `Import` / `Generated` |
| `Analysis` | `string?` | 解析 |
| `ReferenceAnswer` | `string?` | 参考答案（简答题） |
| `TagIds` | `TagId[]` | 挂载的标签（不含难度维度的重复列，见下） |
| `DifficultyTagId` | `TagId` | 难度维度标签（冗余列，NOT NULL，由领域行为同步，P-04） |
| `Options` | `QuestionOption[]` | 客观题选项 |
| `Keypoints` | `QuestionKeypoint[]` | 简答评分要点 |
| `Steps` | `QuestionStep[]` | 综合题评分步骤 |
| `Attachments` | `QuestionAttachment[]` | 附件引用 |
| `BatchId` | `long?` | 导入/生成批次 |
| `PublishedAt` | `DateTimeOffset?` | |
| `Version` | `int` | 乐观并发版本（配合 xmin） |

**领域方法**

| 方法 | 规则 |
|---|---|
| `CreateDraft(...)` | 新建一律 `Draft` |
| `UpdateContent(...)` | 已发布题目允许修改内容，但**修改不影响已生成的试卷快照**（快照已冻结副本） |
| `Publish()` | 必须已选难度标签；校验题型专属字段完整；`Draft → Published`，记录 `PublishedAt` |
| `Disable()` / `Restore()` | `Published → Disabled`；`Disabled → Published`；`Draft` 不可 `Disable`（直接删除） |
| `AttachTag(tagId)` | 标签数 ≤ 5（P-CAT-01）；难度维度标签走 `SetDifficulty` 而非 `AttachTag` |
| `SetDifficulty(tagId)` | 同步 `DifficultyTagId` 与 `TagIds` 中对应项（保持一致） |
| `EnsureValid()` | 题型专属校验（见下） |

**题型专属校验（`EnsureValid`）**

| 题型 | 规则 |
|---|---|
| `Single` | 选项 2..6 个；**恰好 1 个**正确项；选项键唯一 |
| `Multi` | 选项 2..6 个；**至少 2 个**正确项；选项键唯一 |
| `Judge` | 固定两个选项（"正确"/"错误"），正确项固定为第一个；**不参与选项置换** |
| `Short` | 至少 1 个评分要点；每要点有文本与关键词（关键词可为空但需给出提示文案） |
| `Comprehensive` | 至少 1 个评分步骤；步骤有提示、分值（1..40）、参考答案、关键词；**步骤分值之和必须等于 `DefaultScore`** |

**值对象 `Score`**：值对象，`decimal`，范围 0..40（题目分）/ 0..200（试卷总分），携带精度（0.5 步进），提供 `Sum`、`Allocate`（按权重分配并处理余数）。

**值对象 `QuestionOption`**：`Key`（A..F）、`Text`、`IsCorrect`、`SortOrder`。

**值对象 `QuestionKeypoint`**：`Text`、`Keywords[]`、`SortOrder`。

**值对象 `QuestionStep`**：`Code`（s1..sN）、`Prompt`、`ReferenceAnswer`、`Keywords[]`、`Score`、`SortOrder`。

### 3.3 QuestionBank（题库）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `QuestionBankId` |
| `Name` | 名称 |
| `Description` | 说明 |
| `TagIds` | 标签 |
| `Items` | `QuestionBankItem[]`（`QuestionId` + `AddedAt`） |

**领域方法**：`AddQuestion(id)`、`RemoveQuestion(id)`、`EnsureQuestionCanBeAdded(status)`（只允许 `Published` 进入题库？不，允许任何状态但统计分态）。

### 3.4 ImportBatch（导入批次）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `ImportBatchId` |
| `FileName` | 原始文件名 |
| `FileType` | `Csv` / `Xlsx` |
| `ColumnMapping` | `Dictionary<string, string>`：目标字段 → 源列名 |
| `Rows` | `ImportRow[]` |
| `Status` | `Parsed` → `Adopted`（或 `Failed`） |
| `TotalRows` / `ValidRows` / `InvalidRows` | |
| `AdoptedCount` | 采纳后回填 |
| `OperatorId` / `AdoptedBy` / `AdoptedAt` | |

**值对象 `ImportRow`**：`RowNumber`、`Parsed`、`Errors[]`（每条含字段、原因）、`Raw`。

**领域方法**：`MapColumns(mapping)`、`Parse()`（调用 `IQuestionFileParser` 抽象，解析规则在领域外但校验在域内）、`Adopt()`（生成草稿题并标记 `Source=Import`、`BatchId`）。

### 3.5 GenerationBatch（AI 生成批次）聚合根

本期仅建模，不接真实模型。字段：`Prompt`、`QuestionType`、`DifficultyTagId`、`Quantity`、`TagIds`、`Status`（`Generated` → `Adopted`）、`Provider`（占位实现名）、`Rows[]`。

---

## 4. Authoring 上下文

### 4.1 Paper（试卷）聚合根

| 属性 | 类型 | 说明 |
|---|---|---|
| `Id` | `PaperId` | |
| `Kind` | `PaperKind` | `Exam` / `Practice` |
| `Name` | `string` | 必填 |
| `Batch` | `string?` | 考试批次描述（"2026—2027 学年第一学期 · 期中考试"） |
| `Description` | `string?` | |
| `TagIds` | `TagId[]` | ≤ 5 |
| `TotalScore` | `Score` | 目标总分 |
| `DurationMinutes` | `int` | 1..300 |
| `PassScore` | `Score?` | 及格分 |
| `Status` | `PaperStatus` | `Draft` / `Published` / `Archived` |
| `OrderRule` | `OrderRule` | `ByType` / `Manual` |
| `VariantRule` | `VariantRule` | `Standard` / `SmallPlum` / `LargePlum` |
| `AnswerPolicy` | `AnswerPolicy` | `Immediately` / `AfterSubmit` / `AfterClose` |
| `AllowRetake` | `bool` | |
| `RetakeKeepsBest` | `bool` | |
| `Note` | `string?` | 考生须知 |
| `Items` | `PaperItem[]` | 题位集合 |
| `Sections` | `PaperSection[]` | 可选大题分组 |
| `ExamRules` | `ExamRules?` | 仅 kind=Exam：防作弊策略、允许提前入场分钟数 |
| `PracticeRules` | `PracticeRules?` | 仅 kind=Practice：开放范围、可提交次数、反馈时机、错题回流 |
| `PublishedSnapshotId` | `PaperSnapshotId?` | |
| `Version` | `int` | |

**领域方法**

| 方法 | 规则 |
|---|---|
| `CreateDraft(kind, name)` | 初始 `Draft` |
| `UpdateMeta(...)` | 已发布试卷改元信息不影响已生成的快照 |
| `AddItem(question, score, sortOrder)` | 题目须为 `Published`；同题不可重复入卷；分值 0..40 |
| `RemoveItem(questionId)` | |
| `SetItemScore(questionId, score)` | 改动后 `TotalScore` 同步为各项之和（总分以题位之和为准，`TotalScore` 是目标值） |
| `SetOrderRule` / `SetVariantRule` / `SetRules` | |
| `ValidateForPublish()` | 返回 `PublishValidationResult`，逐项检查（见 4.4），**不通过时抛异常或返回带项的结果** |
| `Publish(snapshot)` | 校验通过后置 `Published`，绑定快照 |
| `Unpublish()` | `Published → Draft`，保留快照 |
| `Archive()` | `Published/Draft → Archived`（对应原型的练习"下架"） |
| `EnsureKindConsistency()` | `ExamRules` 与 `PracticeRules` 互斥；kind 与字段不匹配时抛异常 |

**值对象 `ExamRules`**

| 字段 | 默认 | 说明 |
|---|---|---|
| `MaxFocusLoss` | 3 | 切屏上限；`null` 表示不限制（练习用） |
| `OnMaxFocusLoss` | `ForceSubmit` | `Warn` / `ForceSubmit` |
| `RequireFullScreen` | false | |
| `BlockCopyPaste` | true | |
| `BlockContextMenu` | true | |
| `ShowWatermark` | true | 叠加姓名 + 账号 |
| `EnableHeartbeatCheck` | true | |
| `HeartbeatIntervalSeconds` | 15 | |
| `HeartbeatTimeoutSeconds` | 45 | |
| `MaxDisconnect` | 10 | 超过则按断网超时代交 |
| `EarlyEntryMinutes` | 0 | 允许提前入场 |

**值对象 `PracticeRules`**

| 字段 | 默认 | 说明 |
|---|---|---|
| `MaxAttempts` | 0 | 0 = 不限 |
| `FeedbackTiming` | `AfterSubmit` | `Immediate` / `AfterSubmit` |
| `ReflowMistakes` | true | 错题是否回流 |
| `SuggestedMinutes` | 0 | 建议时长（不倒计时） |

**值对象 `PaperItem`**

| 字段 | 说明 |
|---|---|
| `QuestionId` | 引用的题目 |
| `Score` | 卷面分值（唯一事实来源） |
| `SortOrder` | 排序 |
| `SectionId` | 所属大题（可空） |

**值对象 `PaperSection`**：`Title`、`Instructions`、`SortOrder`。

### 4.2 Blueprint（组卷方案）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `BlueprintId` |
| `PaperId` | 所属试卷 |
| `Rules` | `BlueprintRules` |
| `Seed` | `string` | 确定性随机种子 |
| `Status` | `Draft` / `Generated` / `Modified`（已手工修改） |
| `GeneratedItemIds` | 生成结果的题位 ID 列表 |
| `GeneratedAt` / `GeneratedBy` | |
| `Shortfalls` | `Shortfall[]` 池量缺口记录 |
| `ManualModified` | bool |

**值对象 `BlueprintRules`**

| 字段 | 说明 |
|---|---|
| `TagSelector` | `TagSelector`：标签集合 + 是否含子标签 + 匹配模式 |
| `DifficultyQuota` | `Dictionary<TagId, int>` 各难度题数配额 |
| `TypeQuota` | `Dictionary<QuestionType, int>` 各题型题数配额 |
| `TargetTotalScore` | 目标总分 |
| `OrderRule` | 生成后的题序规则 |
| `ScoreAllocation` | `Even`（均分）/ `ByDifficulty`（按难度加权） |

**领域方法**

| 方法 | 规则 |
|---|---|
| `Generate(pool, seed, clock)` | 调用抽题算法；池量不足时记录 `Shortfall` 并**抛出** `InsufficientQuestionPoolException`（携带缺口明细） |
| `MarkManualModified()` | 教师手工调整后调用，状态转 `Modified` |
| `Diff(previous)` | 生成新的规则组合时，与已有题位对比，给出新增/移除/分值变化清单 |

**抽题算法 `QuestionSelectionEngine`（领域服务）**

```
输入：Rules、候选池 pool（已按 Published + 标签 + 难度过滤）、Seed
步骤：
1. 对 pool 按 QuestionId 升序排序，得到稳定基序
2. 计算配额矩阵：cells = {(type, difficulty) → 需要数量}
3. 对每个 cell：
   a. 从该 cell 的候选中，用种子派生的确定性洗牌（mulberry32，种子 = hash(seed + cellKey)）
      取前 N 题；若候选不足，记录 Shortfall{type, difficulty, required, available}
   b. 按 ScoreAllocation 在 cell 内分配分值：
      - Even：cell 总分 = 目标总分按题型配额比例分摊到 cell，cell 内均分，余数按题序靠前
      - ByDifficulty：cell 总分按难度权重分摊
4. 若存在 Shortfall → 抛异常，携带全部缺口（不降级、不替代）
5. 按 OrderRule 排序：
   - ByType：题型固定序（单选→多选→判断→简答→综合操作），同题型内难度升序，同难度内用同一种子洗牌
   - Manual：按抽取顺序
6. 返回题位列表（题位 ID 稳定，便于后续手工微调与差异对比）
确定性保证：同 Rules + 同 Seed + 同 pool 快照 → 完全相同的题位列表
```

**分值分配 `ScoreAllocator`（领域服务）**

```
Allocate(total, weights[], order[]) -> decimal[]
  base = floor(total / n)，逐位保留 2 位小数
  remainder = total - sum(base)
  按 order 从前到后，每次给 +step（step = 0.5），直到 remainder 分配完
  保证 sum(result) == total，且每项 ≥ 0
```

### 4.3 PaperSnapshot（试卷快照）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `PaperSnapshotId` |
| `PaperId` | 来源试卷 |
| `Version` | 版本号，同一试卷递增 |
| `Items` | `SnapshotItem[]`：题目 ID、题型、题干、选项（**已按选项键排序**）、正确答案、评分要点、评分步骤、解析、参考答案、附件引用、卷面分值、题序 |
| `CreatedAt` / `CreatedBy` | |
| `ContentHash` | 内容哈希，用于变更检测 |

**领域方法**：`Create(paper, questions, now, user)` 冻结内容；`Diff(other)` 比较两版差异。

**关键性质**：快照一旦生成不可变。题目后续被修改或停用，**不影响**已生成的快照（满足 FR-AUT-06）。

### 4.4 发布校验 `PaperPublicationValidator`（领域服务）

返回 `IReadOnlyList<ValidationItem>`，每项含 `Key`、`Label`、`Passed`、`Severity`（`Blocking` / `Warning`）、`Detail`（具体原因）、`Targets`（相关题目 ID，便于前端定位）。

| Key | 规则 | 级别 |
|---|---|---|
| `count` | 至少一道题 | Blocking |
| `published` | 所选题均为 `Published` | Blocking |
| `score` | 各题位分值之和 == 目标总分 | Blocking |
| `duplicate` | 试卷内无重复题 | Blocking |
| `subjectiveRatio` | 主观题分值占比 ≤ 40% | **Warning**（可覆盖，需填写理由） |
| `durationFit` | 题均 0.5..20 分钟 且 每分 0.3..3 分钟 | **Warning** |
| `tagCount` | 标签数 ≤ 5 | Blocking |
| `roster` | 考试名单非空（练习豁免，检查开放范围是否已配置） | Blocking |

### 4.5 PaperTemplate（卷型模板）聚合根

字段：`Name`、`Kind`、`VariantRule`、`DurationMinutes`、`PassScore`、`Items`（题目 ID + 分值）、`CreatedBy`。
方法：`CreateFrom(paper)`、`ApplyTo(paper, availableQuestions)`（跳过已停用题目并报告跳过清单）。

### 4.6 卷面派生 `PaperVariantBuilder`（领域服务）

```
输入：Snapshot、VariantRule、考生标识 studentKey、场次种子 sessionSeed
输出：VariantPaper { 题序, 每题选项显示顺序, variantKey }

Standard：题序不变，选项顺序不变。variantKey = "STD"
SmallPlum：题序不变；每题选项用种子 hash(questionId, studentKey, sessionSeed) 洗牌；
           判断题不洗牌。variantKey = studentKey 派生
LargePlum：题型块顺序保留；块内题序用种子洗牌；选项同 SmallPlum 洗牌。variantKey 派生
确定性：同 (studentKey, sessionSeed) 必得同一卷面
```

---

## 5. Delivery 上下文

### 5.1 ExamSession（考试场次）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `ExamSessionId` |
| `PaperId` / `SnapshotId` | 引用的试卷与快照 |
| `Name` | 场次名 |
| `OpenAt` / `CloseAt` | 时间窗（UTC） |
| `DurationMinutes` | 单人作答时长 |
| `Status` | `Scheduled` / `InProgress` / `Closed` / `Cancelled` |
| `VariantRule` | 继承自试卷，发布时可覆盖 |
| `Rules` | `ExamRules`（防作弊策略），继承自试卷，发布时可覆盖 |
| `Note` | 考生须知 |
| `CreatedBy` / `PublishedAt` | |

**领域方法**

| 方法 | 规则 |
|---|---|
| `Create(...)` | 校验 `OpenAt < CloseAt`；时长 > 0 |
| `Publish()` | `Scheduled → InProgress`；校验试卷已发布且有快照；校验名单非空（由应用层在同事务内完成） |
| `Close()` | `InProgress → Closed`；时间窗到达时可自动关闭 |
| `Cancel()` | `Scheduled/InProgress → Cancelled`；已开始的会话按"取消"处理：拒绝继续作答，已提交的保留 |
| `EnsureCanEnter(userId, now)` | 校验：状态可进入、在时间窗内（含提前入场）、用户在名单内、未超重考次数 |
| `EnsureOpenForResumption(attempt, now)` | 校验会话未取消且未超截止时间 |

**状态机**

```
Scheduled ──publish──► InProgress ──close/时间到──► Closed
    │                      │
    └──────cancel─────────┴──► Cancelled
```

### 5.2 ExamParticipant（考生名单项）

| 属性 | 说明 |
|---|---|
| `ExamSessionId` | |
| `UserId` | |
| `Status` | `Invited` / `NotStarted` / `InProgress` / `Submitted` / `Absent` / `Disqualified` |
| `AttemptsUsed` | 已用尝试次数 |

名单来源（`ParticipantMode`）：

| 模式 | 含义 | 展开时机 |
|---|---|---|
| `FromTags` | 按组织维度标签批量纳入（含子标签） | 场次发布时展开并物化 |
| `Direct` | 逐个指定用户（含社会人士） | 场次发布时物化 |
| `OpenToAll` | 全员开放，不限名单 | 发布时不物化名单，登录即可见 |

名单在 `Publish` 时**物化**：把组织标签（含子标签）下的用户展开为独立名单项。名单快照独立于标签的后续变更。

### 5.3 Attempt（作答会话）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `AttemptId` |
| `TargetType` | `Exam` / `Practice` |
| `ExamSessionId` | 考试时必填 |
| `PracticeAssignmentId` | 练习时必填 |
| `UserId` | 考生 |
| `AttemptNo` | 第几次尝试，从 1 开始 |
| `Status` | `NotStarted` / `InProgress` / `Submitted` / `AutoSubmitted` / `ForceSubmitted` / `Abandoned` |
| `StartedAt` | 服务端开始时间 |
| `DeadlineAt` | **服务端计算的截止时间** |
| `SubmittedAt` | |
| `SubmitReason` | `Manual` / `TimeUp` / `ProctorForce` / `AdminForce` / `NetworkTimeout` |
| `LastSavedAt` | 服务端最近一次接受保存的时间 |
| `LastClientSeq` | 服务端已接收的最大客户端序列号 |
| `FocusLossCount` | 服务端权威计数 |
| `DisconnectCount` | |
| `WarningCount` | |
| `VariantKey` | 本次卷面标识 |
| `VariantSeed` | 派生种子 |
| `DurationSpentSeconds` | 实际用时 |

**领域方法**

| 方法 | 规则 |
|---|---|
| `Start(now, deadline)` | 状态 `NotStarted → InProgress`；记录开始时间与截止时间 |
| `EnsureAcceptingAnswers(now)` | 状态必须是 `InProgress` 且 `now <= DeadlineAt`；否则抛异常（超时 → 由应用层触发自动交卷） |
| `AcceptSave(clientSeq, now)` | 幂等：`clientSeq <= LastClientSeq` 直接忽略；更新 `LastClientSeq` 与 `LastSavedAt` |
| `RecordFocusLoss(now)` | 计数 +1；返回是否已达阈值 |
| `RecordDisconnect(now)` | 计数 +1 |
| `RecordWarning()` | 计数 +1 |
| `Submit(reason, now)` | 状态 `InProgress → Submitted/AutoSubmitted/ForceSubmitted`；写 `SubmittedAt`；`SubmitReason`；**幂等**：已提交则直接返回 |
| `EnsureResumable(now)` | 校验会话可恢复（未提交且未超时） |

**状态机**

```
NotStarted ──start──► InProgress ──submit──► Submitted
                          │  ├──timeUp──► AutoSubmitted
                          │  └──proctor──► ForceSubmitted
                          └──(超时未交且被清理)──► Abandoned
```

### 5.4 Answer（作答答案）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `AnswerId` |
| `AttemptId` | |
| `QuestionId` | |
| `PaperItemId` | 卷面题位 |
| `Payload` | `AnswerPayload`（值对象，JSON 化） |
| `IsBlank` | 是否未作答 |
| `Revision` | 修订序号 |
| `SavedAt` | 服务端保存时间 |
| `ClientSeq` | 对应的客户端序列号 |

**值对象 `AnswerPayload`**

| 题型 | 结构 |
|---|---|
| Single / Judge | `SelectedOptionKey`（单值） |
| Multi | `SelectedOptionKeys[]`（排序后的去重数组） |
| Short | `Text` |
| Comprehensive | `Steps[]`（每项 `StepCode` + `Text`） |

`AnswerPayload` 提供 `IsEmpty()` 判定（未作答）。判分策略从 `AnswerPayload` 取值。

### 5.5 AnswerRevision（答案修订流水）

追加式，不可修改。字段：`AttemptId`、`QuestionId`、`ClientSeq`、`Payload`、`SavedAt`、`ClientSentAt`、`ServerReceivedAt`、`Revision`。

唯一约束 `(attempt_id, client_seq)` 保证幂等。

### 5.6 FocusEvent（焦点事件）

追加式。字段：`AttemptId`、`Type`（`WindowBlur` / `PageHidden` / `FullscreenExit` / `CopyAttempt` / `PasteAttempt` / `ContextMenu` / `HeartbeatTimeout`）、`QuestionId?`、`ClientAt`、`ServerReceivedAt`、`Meta`（JSON）。

**值对象 `FocusEventType`**：`IsFocusLoss` 判定哪些类型计入切屏计数（`WindowBlur`、`PageHidden`、`FullscreenExit`）。

### 5.7 ProctorAction（监考动作）

字段：`AttemptId`、`ExamSessionId`、`ActionType`（`Warn` / `Note` / `ForceSubmit`）、`Message`、`Reason`、`OperatorId`、`CreatedAt`。

### 5.8 PracticeAssignment（练习开放单）

字段：`PaperId`（kind=Practice）、`Title`、`TagIds`、`Scope`（组织标签或全体）、`Status`（`Draft` / `Published` / `Archived`）、`Rules`（`PracticeRules`）、`OpenAt` / `CloseAt`（可选）。

---

## 6. Grading 上下文

### 6.1 ScoreResult（评分结果）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `ScoreResultId` |
| `AttemptId` | |
| `QuestionId` / `PaperItemId` | |
| `Score` | 得分 |
| `MaxScore` | 满分（来自卷面分值） |
| `Method` | `AutoScored` / `AutoSuggested` / `ManualScored` |
| `Status` | `Pending`（待阅）/ `AutoScored` / `Suggested` / `Final` |
| `Detail` | `ScoringDetail`（JSON）：命中项、漏选项、要点命中明细 |
| `ScoredBy` | 人工阅卷人 |
| `ScoredAt` | |

**领域方法**：`ApplySuggestion(suggestedScore)`、`ApplyManualScore(score, reviewer)`（校验 0..MaxScore，写入 `GradeRevision` 追加流水）、`Finalize()`。

### 6.2 ReviewTask（阅卷任务）聚合根

| 属性 | 说明 |
|---|---|
| `Id` | `ReviewTaskId` |
| `AttemptId` / `ExamSessionId` | |
| `QuestionId` / `StepId?` | 综合题按步骤拆分 |
| `AnswerText` | 作答原文 |
| `SuggestedScore` | 系统初判建议分 |
| `MaxScore` | 满分 |
| `Status` | `Pending` / `InReview` / `Reviewed` |
| `AssigneeId` | 指派给谁；为空表示待领取 |
| `ReviewerId` | 实际阅卷人 |
| `FinalScore` | 最终分 |
| `Comment` | 评语（学生端可见） |
| `ReviewedAt` | |

**领域方法**：`Claim(reviewerId)`（先到先得，已被领取则失败）、`Assign(userId)`、`Grade(score, comment, reviewer, now)`（校验分数范围，写入 `ScoreResult`）、`AdoptSuggestion(reviewerId)`。

### 6.3 GradePublication（成绩发布）

字段：`ExamSessionId`、`Scope`（`All` / `ObjectiveOnly`）、`PublishedAt`、`PublishedBy`、`IncludedAttemptIds`。

### 6.4 判分策略 `IScoringStrategy`（领域策略）

```csharp
public interface IScoringStrategy
{
    QuestionType SupportedType { get; }
    ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question);
}
```

| 策略 | 规则 |
|---|---|
| `SingleChoiceScoringStrategy` | 选项键完全相等 → 满分；否则 0 |
| `JudgeScoringStrategy` | 同单选（选项固定，不受置换影响，比较的是**原始键**） |
| `MultipleChoiceScoringStrategy` | 错选（选了任何不正确的项）→ 0；漏选（只选了部分正确项，无错选）→ `MaxScore × (命中数 / 正确项数) × 0.5`；全对 → 满分 |
| `ShortAnswerScoringStrategy` | 逐要点判定：要点关键词全部命中（大小写与全半角归一后包含匹配）则该要点得分；得分 = `MaxScore × 命中要点数 / 要点总数`，产出 `AutoSuggested` |
| `ComprehensiveScoringStrategy` | 逐步骤判定，步骤分 = `MaxScore × Σ(命中步骤分) / Σ(步骤分)`，产出 `AutoSuggested` |

**关键词匹配规则**：归一化（去空格、全角转半角、大小写折叠、中文标点忽略）后做**包含匹配**；要点关键词全部命中才算该要点得分（AND 语义）。

**判分时机**：交卷事务内，客观题立即产出 `ScoreResult`（`AutoScored`）；主观题产出 `ScoreResult`（`Suggested`）+ `ReviewTask`（`Pending`）。

### 6.5 错题回流（Learning 上下文）

由 `ScoreFinalized` 事件驱动：若题目为客观题且判为错误，或主观题最终分 < 满分，则写入/更新 `Mistake`：

| 字段 | 说明 |
|---|---|
| `UserId` / `QuestionId` | |
| `WrongCount` | 累计错误次数 |
| `LastWrongAt` | |
| `Reason` | 错因：多选漏选/错选、单选判断错、判断结论错、简答要点未覆盖、综合题步骤缺失、未作答 |
| `SourceType` / `SourceAttemptId` | 来源 |
| `ResolvedAt` | 重做正确后置位 |

---

## 7. Learning 上下文

### 7.1 Mistake（错题）

见 6.5。领域方法：`RecordWrong(reason, attemptId, now)`、`Resolve(now)`、`MarkMastered()`。

### 7.2 AbilityProfile（能力画像）

由 `ScoreFinalized` 事件增量更新。字段：`UserId`、`AbilityTagId`、`MasteryRate`（0..1）、`SampleSize`、`CorrectCount`、`UpdatedAt`。

**掌握度算法**（`MasteryCalculator`，领域服务）：

```
mastery = (Σ 得分率² 的加权平均)  /  (1 + 0.1 × ln(1 + sampleSize))
其中 得分率 = score / maxScore（未作答计 0）
样本量 < 5 时，画像标记为"样本不足"，不参与能力排序
```

### 7.3 PracticeResult（练习结果）

字段：`UserId`、`PracticeAssignmentId`、`AttemptId`、`SubmittedAt`、`Score`、`TotalScore`、`DurationSeconds`、`AttemptNo`。

---

## 8. Analytics 上下文（读模型）

| 读模型 | 内容 | 刷新时机 |
|---|---|---|
| `ExamStatistic` | 平均分、最高、最低、及格率、优秀率、分数段分布、提交人数、缺考人数 | 交卷 / 成绩发布后增量更新 |
| `QuestionStatistic` | 每题的作答人数、正确率、平均得分、得分率分布、掌握度标签 | 同上 |
| `TypeStatistic` | 题型得分率 | 同上 |
| `AbilityStatistic` | 能力维度得分率（班级 / 个人） | 同上 |

Analytics 只读，不写业务表。读模型落后于原始作答数据时，查询会当场重算，保证统计与作答数据始终一致；`Exam.Worker` 另有定时作业——每隔几分钟增量重算落后的场次，每日一次全量重算，修正增量误差。

---

## 9. Audit 上下文

`AuditLog`（追加式）：`Id`、`OperatorId`、`OperatorName`、`Action`（权限码或自定义动作）、`TargetType`、`TargetId`、`Summary`（变更摘要 JSON）、`Ip`、`UserAgent`、`RequestId`、`OccurredAt`。

---

## 10. 领域事件清单

| 事件 | 载荷要点 |
|---|---|
| `UserRegistered` | UserId, Username |
| `UserAuthenticated` | UserId, Ip |
| `UserAuthenticatedFailed` | Username, Reason |
| `UserPasswordChanged` | UserId |
| `UserRoleChanged` | UserId, AddedRoles, RemovedRoles |
| `UserDisabled` | UserId, Reason |
| `UserTagsChanged` | UserId, AddedTagIds, RemovedTagIds |
| `TagCreated` / `TagRenamed` / `TagDeleted` | TagId, Group, Name |
| `QuestionCreated` | QuestionId, Type, Source |
| `QuestionPublished` | QuestionId, TagIds, DifficultyTagId |
| `QuestionDisabled` | QuestionId |
| `QuestionDeleted` | QuestionId |
| `QuestionBankChanged` | BankId, AddedCount, RemovedCount |
| `ImportBatchAdopted` | BatchId, AdoptedCount |
| `BlueprintGenerated` | BlueprintId, PaperId, ItemCount, ShortfallCount |
| `PaperPublished` | PaperId, SnapshotId, Version |
| `PaperUnpublished` | PaperId |
| `PaperArchived` | PaperId |
| `ExamSessionPublished` | ExamSessionId, PaperId, ParticipantCount |
| `ExamSessionClosed` | ExamSessionId |
| `ExamSessionCancelled` | ExamSessionId, Reason |
| `AttemptStarted` | AttemptId, UserId, ExamSessionId? |
| `AttemptSubmitted` | AttemptId, UserId, SubmitReason, ScoreSnapshot |
| `FocusLossRecorded` | AttemptId, Count, LimitReached |
| `ProctorActionIssued` | AttemptId, ActionType, OperatorId |
| `ScoreFinalized` | AttemptId, QuestionId, Score, MaxScore, IsCorrect |
| `ReviewTaskCompleted` | ReviewTaskId, ReviewerId, FinalScore |
| `GradePublished` | ExamSessionId, Scope |
| `MistakeRecorded` | UserId, QuestionId, Reason |

---

## 11. 领域异常与错误码

错误码采用 `模块号 + 4 位序号`，如 `2201`。HTTP 状态码由异常类型映射。

| 错误码 | 异常 | HTTP | 含义 |
|---|---|---|---|
| 20001 | `ValidationException` | 400 | 请求参数校验失败 |
| 20002 | `ConcurrencyConflictException` | 409 | 数据已被他人修改 |
| 20003 | `NotFoundException` | 404 | 资源不存在 |
| 20004 | `ForbiddenException` | 403 | 无权限 |
| 20005 | `BusinessRuleException` | 422 | 违反业务规则（携带明细） |
| 21001 | `InvalidStateTransitionException` | 422 | 非法状态流转 |
| 22001 | `DuplicateCodeException` | 409 | 编码重复 |
| 22101 | `TagUsageException` | 422 | 标签被引用，不可删除 |
| 23001 | `QuestionValidationException` | 422 | 题目内容不合法（携带具体违规项） |
| 23101 | `InsufficientQuestionPoolException` | 422 | 组卷池量不足（携带缺口明细） |
| 24001 | `PaperPublicationException` | 422 | 发布校验未通过（携带校验项） |
| 24101 | `PaperImmutableException` | 422 | 试卷已发布，不可修改题位 |
| 25001 | `AttemptStateException` | 422 | 会话状态不允许该操作 |
| 25002 | `AttemptDeadlineExceededException` | 409 | 已超过作答截止时间 |
| 25003 | `AttemptAlreadySubmittedException` | 200（幂等返回既有结果） | 已交卷 |
| 25004 | `ParticipantQuotaExceededException` | 422 | 超过可提交次数 |
| 25101 | `FocusLimitExceededException` | 422 | 切屏次数超限 |
| 26001 | `ScoringException` | 500 | 判分异常 |
| 27001 | `ImportRowInvalidException` | 422 | 导入行数据非法 |
| 28001 | `TagCycleException` | 422 | 标签层级成环 |
| 28002 | `TagInUseException` | 422 | 标签被引用，不可删除 |
| 29005 | `OriginalPasswordNotConfiguredException` | 422 | 未配置原始密码，无法重置密码 |

29xxx 是身份域的码段；29001–29004 保留未用（登录失败等走 `20005` 业务规则）。

所有领域异常继承 `DomainException`，携带 `ErrorCode`、`Message`（面向用户的中文提示）与可选 `Details`（结构化明细，映射为 ProblemDetails 的 `extensions`）。

---

## 12. 关键算法汇总

| 算法 | 位置 | 要点 |
|---|---|---|
| 标签树后代展开 | `TagTreeResolver` | 递归 CTE，一次查询展开全部后代 |
| 确定性洗牌 | `DeterministicShuffle` | mulberry32 + Fisher-Yates，种子由 `hash(seed + context)` 派生 |
| 抽题 | `QuestionSelectionEngine` | 配额矩阵 + 按 cell 确定性抽取；不足即报错不降级 |
| 分值分配 | `ScoreAllocator` | 余数按序分配，保证总和精确等于目标 |
| 卷面派生 | `PaperVariantBuilder` | 标准/小梅花/大梅花；判断题不参与置换 |
| 判分 | `IScoringStrategy` 四种实现 + 关键词匹配 | 多选错选 0 分漏选折半 |
| 掌握度 | `MasteryCalculator` | 样本量 < 5 标记样本不足 |
| 时钟偏移 | `ServerTimeSync` | 多次采样取中位数，突变 > 5s 告警 |
| 掌握度筛选 | 见 `FR-LRN-02` | — |
