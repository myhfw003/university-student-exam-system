using Exam.Application.Learning.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Learning;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 练习摘要装配。
/// <para>
/// 练习规则以**试卷上的练习规则**为准（开放单上的规则是留给将来做单次覆盖的）。
/// </para>
/// </summary>
public static class PracticeSummaryFactory
{
    /// <summary>装配一条练习摘要。</summary>
    public static PracticeSummaryDto Build(
        PracticeAssignment assignment,
        Paper? paper,
        IReadOnlyDictionary<long, string> tagNameById,
        int usedAttempts,
        DateTimeOffset now)
    {
        var rules = paper?.PracticeRules ?? PracticeRules.Default;
        var remaining = rules.MaxAttempts > 0
            ? Math.Max(0, rules.MaxAttempts - usedAttempts)
            : (int?)null;

        var tagNames = paper is null
            ? []
            : paper.TagIds
                .Select(id => tagNameById.GetValueOrDefault(id, string.Empty))
                .Where(name => name.Length > 0)
                .ToList();

        var canStart = assignment.IsOpen(now)
            && (rules.MaxAttempts <= 0 || usedAttempts < rules.MaxAttempts);

        return new PracticeSummaryDto(
            assignment.Id,
            assignment.Title,
            assignment.PaperId,
            paper?.Name ?? string.Empty,
            paper?.Items.Count ?? 0,
            paper?.TotalItemScore ?? 0m,
            tagNames,
            rules.MaxAttempts,
            usedAttempts,
            remaining,
            rules.FeedbackTiming,
            rules.ReflowMistakes,
            rules.SuggestedMinutes,
            assignment.OpenAt,
            assignment.CloseAt,
            assignment.PublishedAt,
            canStart);
    }
}
