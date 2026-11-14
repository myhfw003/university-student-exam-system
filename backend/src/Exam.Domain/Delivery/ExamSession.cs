using Exam.Domain.Authoring;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Delivery;

/// <summary>考试场次状态。</summary>
public enum ExamSessionStatus
{
    /// <summary>已创建，未发布。</summary>
    Scheduled,

    /// <summary>进行中。</summary>
    InProgress,

    /// <summary>已关闭。</summary>
    Closed,

    /// <summary>已取消。</summary>
    Cancelled,
}

/// <summary>名单纳入方式。</summary>
public enum ParticipantMode
{
    /// <summary>按组织维度标签批量纳入（含子标签）。</summary>
    FromTags,

    /// <summary>逐个指定用户，可含社会人士。</summary>
    Direct,

    /// <summary>全员开放，所有已注册用户可见。</summary>
    OpenToAll,
}

/// <summary>
/// 考试场次聚合根。一场考试的时间窗、名单口径与防作弊策略都在这里。
/// <para>
/// 场次引用**已发布的试卷快照**：题目之后怎么改都不影响这场考试。
/// </para>
/// </summary>
public sealed class ExamSession : AuditableEntity, IAuditedEntity
{
    private ExamSession()
    {
    }

    private ExamSession(
        long paperId,
        string name,
        DateTimeOffset openAt,
        DateTimeOffset closeAt,
        int durationMinutes,
        ParticipantMode participantMode,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        PaperId = paperId;
        Name = name;
        OpenAt = openAt;
        CloseAt = closeAt;
        DurationMinutes = durationMinutes;
        ParticipantMode = participantMode;
        Status = ExamSessionStatus.Scheduled;
        VariantRule = VariantRule.Standard;
        Rules = ExamRules.Default;
    }

    /// <summary>引用的试卷。</summary>
    public long PaperId { get; private set; }

    /// <summary>引用的试卷快照。发布时绑定。</summary>
    public long? SnapshotId { get; private set; }

    /// <summary>场次名称。</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>开放时间（UTC）。</summary>
    public DateTimeOffset OpenAt { get; private set; }

    /// <summary>关闭时间（UTC）。</summary>
    public DateTimeOffset CloseAt { get; private set; }

    /// <summary>单人作答时长（分钟）。</summary>
    public int DurationMinutes { get; private set; }

    /// <summary>场次状态。</summary>
    public ExamSessionStatus Status { get; private set; }

    /// <summary>卷型规则。默认继承试卷，发布时可覆盖。</summary>
    public VariantRule VariantRule { get; private set; }

    /// <summary>防作弊策略。</summary>
    public ExamRules Rules { get; private set; } = ExamRules.Default;

    /// <summary>考生须知。</summary>
    public string? Note { get; private set; }

    /// <summary>名单纳入方式。</summary>
    public ParticipantMode ParticipantMode { get; private set; }

    /// <summary>按标签纳入时使用的组织维度标签。</summary>
    public IReadOnlyList<long> ParticipantTagIds { get; private set; } = [];

    /// <summary>直接指定的用户。</summary>
    public IReadOnlyList<long> ParticipantUserIds { get; private set; } = [];

    /// <summary>发布时间。</summary>
    public DateTimeOffset? PublishedAt { get; private set; }

    /// <summary>关闭时间。</summary>
    public DateTimeOffset? ClosedAt { get; private set; }

    /// <summary>是否已发布（进入过进行中）。</summary>
    public bool IsPublished => PublishedAt is not null;

    public static ExamSession Create(
        long paperId,
        string name,
        DateTimeOffset openAt,
        DateTimeOffset closeAt,
        int durationMinutes,
        ParticipantMode participantMode,
        DateTimeOffset now,
        long? actorId = null,
        IReadOnlyList<long>? participantTagIds = null,
        IReadOnlyList<long>? participantUserIds = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("场次名称不能为空。");
        }

        EnsureWindow(openAt, closeAt);

        if (durationMinutes <= 0)
        {
            throw new BusinessRuleException("作答时长必须大于 0 分钟。");
        }

        EnsureParticipantInput(participantMode, participantTagIds, participantUserIds);

        var session = new ExamSession(
            paperId,
            name.Trim(),
            openAt,
            closeAt,
            durationMinutes,
            participantMode,
            now,
            actorId)
        {
            ParticipantTagIds = participantTagIds?.Distinct().ToList() ?? [],
            ParticipantUserIds = participantUserIds?.Distinct().ToList() ?? [],
        };

        return session;
    }

    /// <summary>修改场次配置。只有未发布的场次能改。</summary>
    public void Update(
        string name,
        DateTimeOffset openAt,
        DateTimeOffset closeAt,
        int durationMinutes,
        ParticipantMode participantMode,
        IReadOnlyList<long>? participantTagIds,
        IReadOnlyList<long>? participantUserIds,
        VariantRule variantRule,
        ExamRules rules,
        string? note,
        DateTimeOffset now,
        long? actorId = null)
    {
        EnsureScheduled();

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new BusinessRuleException("场次名称不能为空。");
        }

        EnsureWindow(openAt, closeAt);

        if (durationMinutes <= 0)
        {
            throw new BusinessRuleException("作答时长必须大于 0 分钟。");
        }

        EnsureParticipantInput(participantMode, participantTagIds, participantUserIds);

        Name = name.Trim();
        OpenAt = openAt;
        CloseAt = closeAt;
        DurationMinutes = durationMinutes;
        ParticipantMode = participantMode;
        ParticipantTagIds = participantTagIds?.Distinct().ToList() ?? [];
        ParticipantUserIds = participantUserIds?.Distinct().ToList() ?? [];
        VariantRule = variantRule;
        Rules = rules;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Touch(now, actorId);
    }

    /// <summary>发布。绑定试卷快照，场次进入进行中。</summary>
    public void Publish(long snapshotId, DateTimeOffset now, long? actorId = null)
    {
        if (Status != ExamSessionStatus.Scheduled)
        {
            throw new InvalidStateTransitionException("只有已创建未发布的场次才能发布。");
        }

        if (snapshotId <= 0)
        {
            throw new BusinessRuleException("发布场次前必须先发布试卷并生成快照。");
        }

        SnapshotId = snapshotId;
        Status = ExamSessionStatus.InProgress;
        PublishedAt = now;
        Touch(now, actorId);
    }

    /// <summary>关闭场次。</summary>
    public void Close(DateTimeOffset now, long? actorId = null)
    {
        if (Status != ExamSessionStatus.InProgress)
        {
            throw new InvalidStateTransitionException("只有进行中的场次才能关闭。");
        }

        Status = ExamSessionStatus.Closed;
        ClosedAt = now;
        Touch(now, actorId);
    }

    /// <summary>取消场次。已开始的会话按取消处理：拒绝继续作答，已提交的保留。</summary>
    public void Cancel(DateTimeOffset now, long? actorId = null)
    {
        if (Status is not (ExamSessionStatus.Scheduled or ExamSessionStatus.InProgress))
        {
            throw new InvalidStateTransitionException("只有未关闭、未取消的场次才能取消。");
        }

        Status = ExamSessionStatus.Cancelled;
        ClosedAt = now;
        Touch(now, actorId);
    }

    /// <summary>
    /// 校验考生此刻能否进入。名单归属由应用层校验——这里只看时间窗与状态。
    /// </summary>
    public void EnsureCanEnter(DateTimeOffset now)
    {
        if (Status == ExamSessionStatus.Cancelled)
        {
            throw new BusinessRuleException("场次已取消，无法进入。");
        }

        if (Status != ExamSessionStatus.InProgress)
        {
            throw new BusinessRuleException("场次尚未发布或已结束，无法进入。");
        }

        var earlyEntry = TimeSpan.FromMinutes(Math.Max(0, Rules.EarlyEntryMinutes));
        if (now < OpenAt - earlyEntry)
        {
            throw new BusinessRuleException("尚未到开放时间，暂时无法进入。");
        }

        if (now > CloseAt)
        {
            throw new BusinessRuleException("场次已超过关闭时间，无法进入。");
        }
    }

    /// <summary>发布后还能不能改配置。</summary>
    public void EnsureScheduled()
    {
        if (Status != ExamSessionStatus.Scheduled)
        {
            throw new InvalidStateTransitionException("场次已发布，不能再修改配置。");
        }
    }

    private static void EnsureWindow(DateTimeOffset openAt, DateTimeOffset closeAt)
    {
        if (openAt >= closeAt)
        {
            throw new BusinessRuleException("开放时间必须早于关闭时间。");
        }
    }

    private static void EnsureParticipantInput(
        ParticipantMode mode,
        IReadOnlyList<long>? participantTagIds,
        IReadOnlyList<long>? participantUserIds)
    {
        switch (mode)
        {
            case ParticipantMode.FromTags when participantTagIds is null || participantTagIds.Count == 0:
                throw new BusinessRuleException("按标签纳入时必须至少选择一个组织标签。");
            case ParticipantMode.Direct when participantUserIds is null || participantUserIds.Count == 0:
                throw new BusinessRuleException("指定考生时必须至少选择一名考生。");
        }
    }
}

public static class ExamSessionStatuses
{
    public static string ToStorage(this ExamSessionStatus status) => status switch
    {
        ExamSessionStatus.InProgress => "in_progress",
        ExamSessionStatus.Closed => "closed",
        ExamSessionStatus.Cancelled => "cancelled",
        _ => "scheduled",
    };

    public static ExamSessionStatus? FromStorage(string? storage) => storage switch
    {
        "scheduled" => ExamSessionStatus.Scheduled,
        "in_progress" => ExamSessionStatus.InProgress,
        "closed" => ExamSessionStatus.Closed,
        "cancelled" => ExamSessionStatus.Cancelled,
        _ => null,
    };

    public static string Label(this ExamSessionStatus status) => status switch
    {
        ExamSessionStatus.InProgress => "进行中",
        ExamSessionStatus.Closed => "已关闭",
        ExamSessionStatus.Cancelled => "已取消",
        _ => "未发布",
    };
}

public static class ParticipantModes
{
    public static string ToStorage(this ParticipantMode mode) => mode switch
    {
        ParticipantMode.FromTags => "tags",
        ParticipantMode.Direct => "direct",
        _ => "open",
    };

    public static ParticipantMode? FromStorage(string? storage) => storage switch
    {
        "tags" => ParticipantMode.FromTags,
        "direct" => ParticipantMode.Direct,
        "open" => ParticipantMode.OpenToAll,
        _ => null,
    };

    public static string Label(this ParticipantMode mode) => mode switch
    {
        ParticipantMode.FromTags => "按组织标签",
        ParticipantMode.Direct => "指定考生",
        _ => "全员开放",
    };
}
