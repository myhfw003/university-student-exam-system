using Exam.Domain.SharedKernel.Events;

namespace Exam.Domain.Grading.Events;

/// <summary>
/// 成绩定分。
/// <para>
/// 客观题交卷即定分，主观题人工评分后定分。错题回流与掌握度更新都靠它。
/// </para>
/// </summary>
public sealed record ScoreFinalized(
    long AttemptId,
    long QuestionId,
    decimal Score,
    decimal MaxScore,
    string Method,
    IReadOnlyList<string> HitItems,
    IReadOnlyList<string> MissedItems) : DomainEvent;
