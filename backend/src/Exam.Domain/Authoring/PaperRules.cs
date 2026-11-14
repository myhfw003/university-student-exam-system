namespace Exam.Domain.Authoring;

/// <summary>
/// 考试卷规则：防作弊策略与入场设置。
/// <para>值对象，不可变；修改即整体替换。</para>
/// </summary>
public sealed record ExamRules
{
    /// <summary>切屏次数上限。null 表示不限制（练习场景）。</summary>
    public int? MaxFocusLoss { get; init; } = 3;

    /// <summary>达到切屏上限时的处置：警告或强制交卷。</summary>
    public string OnMaxFocusLoss { get; init; } = "force_submit";

    public bool RequireFullScreen { get; init; }

    public bool BlockCopyPaste { get; init; } = true;

    public bool BlockContextMenu { get; init; } = true;

    public bool ShowWatermark { get; init; } = true;

    public bool EnableHeartbeatCheck { get; init; } = true;

    public int HeartbeatIntervalSeconds { get; init; } = 15;

    public int HeartbeatTimeoutSeconds { get; init; } = 45;

    /// <summary>允许的最大断连次数，超过则按断网超时代交。</summary>
    public int MaxDisconnect { get; init; } = 10;

    /// <summary>允许提前入场分钟数。</summary>
    public int EarlyEntryMinutes { get; init; }

    public static ExamRules Default { get; } = new();
}

/// <summary>练习卷规则：次数、反馈时机与错题回流。</summary>
public sealed record PracticeRules
{
    /// <summary>可提交次数。0 表示不限。</summary>
    public int MaxAttempts { get; init; }

    /// <summary>反馈时机：immediate 或 after_submit。</summary>
    public string FeedbackTiming { get; init; } = "after_submit";

    /// <summary>错题是否回流到错题本。</summary>
    public bool ReflowMistakes { get; init; } = true;

    /// <summary>建议时长（分钟）。只是建议，不倒计时。</summary>
    public int SuggestedMinutes { get; init; }

    public static PracticeRules Default { get; } = new();
}
