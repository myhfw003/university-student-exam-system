using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 练习规则解析。
/// <para>规则以**练习试卷上的练习规则**为准；找不到时用默认规则（不限次数、提交后反馈、错题回流）。</para>
/// </summary>
public sealed class PracticeRulesResolver
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly IPaperRepository _papers;

    public PracticeRulesResolver(
        IPracticeAssignmentRepository assignments,
        IPaperRepository papers)
    {
        _assignments = assignments;
        _papers = papers;
    }

    /// <summary>取某个练习开放单的规则。</summary>
    public async Task<PracticeRules> ResolveAsync(
        long practiceAssignmentId,
        CancellationToken cancellationToken = default)
    {
        var assignment = await _assignments.GetByIdAsync(practiceAssignmentId, cancellationToken);
        if (assignment is null)
        {
            return PracticeRules.Default;
        }

        var paper = await _papers.GetByIdAsync(assignment.PaperId, cancellationToken);
        return paper?.PracticeRules ?? PracticeRules.Default;
    }
}
