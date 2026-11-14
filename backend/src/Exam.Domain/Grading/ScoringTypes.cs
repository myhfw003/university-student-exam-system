using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;

namespace Exam.Domain.Grading;

/// <summary>评分方式。</summary>
public enum ScoringMethod
{
    /// <summary>自动评分：客观题。</summary>
    AutoScored,

    /// <summary>系统建议分：主观题，等待人工确认。</summary>
    AutoSuggested,

    /// <summary>人工评分。</summary>
    ManualScored,
}

/// <summary>评分状态。</summary>
public enum ScoringStatus
{
    /// <summary>待阅。</summary>
    Pending,

    /// <summary>已自动评分。</summary>
    AutoScored,

    /// <summary>已有建议分，待确认。</summary>
    Suggested,

    /// <summary>已定分。</summary>
    Final,
}

/// <summary>评分结果。</summary>
public sealed record ScoringOutcome(
    decimal Score,
    decimal MaxScore,
    ScoringMethod Method,
    ScoringStatus Status,
    IReadOnlyList<string> Details)
{
    /// <summary>全对或全得分。</summary>
    public bool IsFullScore => Score >= MaxScore;
}

/// <summary>
/// 判分策略（领域策略）。
/// <para>
/// 每种题型一个实现。判分只看「学生答了什么」与「卷面上正确答案是什么」，
/// 不碰数据库，也不关心这次考试之外的事。
/// </para>
/// </summary>
public interface IScoringStrategy
{
    /// <summary>本策略支持的题型。</summary>
    QuestionType SupportedType { get; }

    /// <summary>判分。</summary>
    /// <param name="answer">学生答案。</param>
    /// <param name="item">卷面题位（分值在这里）。</param>
    /// <param name="question">卷面题目（正确答案、要点、步骤在这里）。</param>
    ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question);
}

/// <summary>判分策略注册表。</summary>
public static class ScoringStrategies
{
    private static readonly SingleChoiceScoringStrategy Single = new();
    private static readonly JudgeScoringStrategy Judge = new();
    private static readonly MultipleChoiceScoringStrategy Multi = new();
    private static readonly ShortAnswerScoringStrategy Short = new();
    private static readonly ComprehensiveScoringStrategy Comprehensive = new();

    /// <summary>取指定题型的策略。</summary>
    public static IScoringStrategy For(QuestionType type) => type switch
    {
        QuestionType.Single => Single,
        QuestionType.Judge => Judge,
        QuestionType.Multi => Multi,
        QuestionType.Short => Short,
        QuestionType.Comprehensive => Comprehensive,
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "未知题型。"),
    };
}
