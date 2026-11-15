using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 练习开放单的管理服务。
/// <para>开放范围只能是**组织维度**的标签——练习是按班级、专业这类范围投放的。</para>
/// </summary>
public sealed class PracticeAssignmentService
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly IPaperRepository _papers;
    private readonly ITagRepository _tags;
    private readonly IAttemptRepository _attempts;

    public PracticeAssignmentService(
        IPracticeAssignmentRepository assignments,
        IPaperRepository papers,
        ITagRepository tags,
        IAttemptRepository attempts)
    {
        _assignments = assignments;
        _papers = papers;
        _tags = tags;
        _attempts = attempts;
    }

    /// <summary>校验开放范围：只能是组织维度的标签。</summary>
    public async Task EnsureOrganizationScopeAsync(
        IReadOnlyCollection<long>? scopeTagIds,
        CancellationToken cancellationToken = default)
    {
        if (scopeTagIds is null || scopeTagIds.Count == 0)
        {
            return;
        }

        var tags = await _tags.GetByIdsAsync(scopeTagIds.ToList(), cancellationToken);
        if (tags.Count != scopeTagIds.Distinct().Count())
        {
            throw new BusinessRuleException("开放范围里的标签不存在。");
        }

        if (tags.Any(t => t.Group != TagGroup.Organization))
        {
            throw new BusinessRuleException("开放范围只能选组织维度的标签。");
        }
    }

    /// <summary>装配一条练习开放单。</summary>
    public async Task<PracticeAssignmentDto> BuildDtoAsync(
        PracticeAssignment assignment,
        CancellationToken cancellationToken = default)
    {
        var items = await BuildDtosAsync([assignment], cancellationToken);
        return items[0];
    }

    /// <summary>装配一批练习开放单。试卷、标签与做题次数各取一次，别一份一份去查。</summary>
    public async Task<IReadOnlyList<PracticeAssignmentDto>> BuildDtosAsync(
        IReadOnlyList<PracticeAssignment> assignments,
        CancellationToken cancellationToken = default)
    {
        if (assignments.Count == 0)
        {
            return [];
        }

        var papers = await _papers.GetByIdsAsync(
            assignments.Select(a => a.PaperId).Distinct().ToList(),
            cancellationToken);
        var paperById = papers.ToDictionary(p => p.Id);

        var scopeTagIds = assignments.SelectMany(a => a.ScopeTagIds).Distinct().ToList();
        var tags = scopeTagIds.Count > 0
            ? await _tags.GetByIdsAsync(scopeTagIds, cancellationToken)
            : [];
        var tagNameById = tags.ToDictionary(t => t.Id, t => t.Name);

        var counts = await _attempts.CountByPracticeAssignmentsAsync(
            assignments.Select(a => a.Id).ToList(),
            cancellationToken);

        return assignments
            .Select(a => new PracticeAssignmentDto(
                a.Id,
                a.Title,
                a.PaperId,
                paperById.GetValueOrDefault(a.PaperId)?.Name ?? string.Empty,
                paperById.GetValueOrDefault(a.PaperId)?.Items.Count ?? 0,
                paperById.GetValueOrDefault(a.PaperId)?.TotalItemScore ?? 0m,
                a.Status.ToStorage(),
                a.Status.Label(),
                a.ScopeTagIds,
                a.ScopeTagIds.Select(id => tagNameById.GetValueOrDefault(id, string.Empty))
                    .Where(name => name.Length > 0)
                    .ToList(),
                a.OpenAt,
                a.CloseAt,
                a.PublishedAt,
                a.CreatedAt,
                counts.GetValueOrDefault(a.Id)))
            .ToList();
    }
}
