using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Identity;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Learning.Queries;

/// <summary>
/// 可见练习列表。
/// <para>只列该考生**看得见**的练习：已上架、在开放期内、命中开放范围（组织标签）。</para>
/// </summary>
public sealed record ListPracticesQuery(
    string? Keyword,
    long? TagId,
    int Page,
    int Size) : IAppQuery<PracticeListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class ListPracticesHandler : IRequestHandler<ListPracticesQuery, PracticeListResponse>
{
    private readonly PracticeVisibilityResolver _visibility;
    private readonly IPaperRepository _papers;
    private readonly ITagRepository _tags;
    private readonly IAttemptRepository _attempts;
    private readonly ICurrentUser _currentUser;
    private readonly IClock _clock;

    public ListPracticesHandler(
        PracticeVisibilityResolver visibility,
        IPaperRepository papers,
        ITagRepository tags,
        IAttemptRepository attempts,
        ICurrentUser currentUser,
        IClock clock)
    {
        _visibility = visibility;
        _papers = papers;
        _tags = tags;
        _attempts = attempts;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<PracticeListResponse> Handle(
        ListPracticesQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 100);
        var now = _clock.UtcNow;

        var visible = await _visibility.ListVisibleAsync(userId, now, cancellationToken);

        // 关键词按标题找。
        var filtered = visible
            .Where(p => string.IsNullOrWhiteSpace(request.Keyword)
                || p.Title.Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase))
            .ToList();

        // 标签过滤按练习对应试卷的标签，父标签连子标签一起算。
        if (request.TagId is { } tagId)
        {
            var tagIds = (await _tags.GetDescendantIdsAsync(tagId, includeSelf: true, cancellationToken)).ToHashSet();
            var papers = await _papers.GetByIdsAsync(filtered.Select(p => p.PaperId).Distinct().ToList(), cancellationToken);
            var matched = papers
                .Where(p => p.TagIds.Any(tagIds.Contains))
                .Select(p => p.Id)
                .ToHashSet();

            filtered = filtered.Where(p => matched.Contains(p.PaperId)).ToList();
        }

        var total = filtered.Count;
        var pageItems = filtered.Skip((page - 1) * size).Take(size).ToList();

        return new PracticeListResponse(
            await PracticeSummaryBuilder.BuildAsync(userId, pageItems, now, _papers, _tags, _attempts, cancellationToken),
            total,
            page,
            size);
    }
}

/// <summary>单个练习详情。</summary>
public sealed record GetPracticeQuery(long Id) : IAppQuery<PracticeSummaryDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetPracticeHandler : IRequestHandler<GetPracticeQuery, PracticeSummaryDto>
{
    private readonly PracticeVisibilityResolver _visibility;
    private readonly IPaperRepository _papers;
    private readonly ITagRepository _tags;
    private readonly IAttemptRepository _attempts;
    private readonly ICurrentUser _currentUser;
    private readonly IClock _clock;

    public GetPracticeHandler(
        PracticeVisibilityResolver visibility,
        IPaperRepository papers,
        ITagRepository tags,
        IAttemptRepository attempts,
        ICurrentUser currentUser,
        IClock clock)
    {
        _visibility = visibility;
        _papers = papers;
        _tags = tags;
        _attempts = attempts;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<PracticeSummaryDto> Handle(
        GetPracticeQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var now = _clock.UtcNow;
        var visible = await _visibility.ListVisibleAsync(userId, now, cancellationToken);

        var assignment = visible.FirstOrDefault(p => p.Id == request.Id)
            ?? throw new NotFoundException("练习不存在或不在可见范围内。");

        var items = await PracticeSummaryBuilder.BuildAsync(
            userId,
            [assignment],
            now,
            _papers,
            _tags,
            _attempts,
            cancellationToken);

        return items[0];
    }
}

/// <summary>练习摘要装配（列表与详情共用）。</summary>
internal static class PracticeSummaryBuilder
{
    public static async Task<IReadOnlyList<PracticeSummaryDto>> BuildAsync(
        long userId,
        IReadOnlyList<PracticeAssignment> assignments,
        DateTimeOffset now,
        IPaperRepository papers,
        ITagRepository tags,
        IAttemptRepository attempts,
        CancellationToken cancellationToken)
    {
        if (assignments.Count == 0)
        {
            return [];
        }

        var paperList = await papers.GetByIdsAsync(
            assignments.Select(a => a.PaperId).Distinct().ToList(),
            cancellationToken);
        var paperById = paperList.ToDictionary(p => p.Id);

        var tagIds = paperList.SelectMany(p => p.TagIds).Distinct().ToList();
        var tagList = tagIds.Count > 0 ? await tags.GetByIdsAsync(tagIds, cancellationToken) : [];
        var tagNameById = tagList.ToDictionary(t => t.Id, t => t.Name);

        var usedByPractice = (await attempts.ListByUserAsync(userId, cancellationToken))
            .Where(a => a.PracticeAssignmentId != null)
            .GroupBy(a => a.PracticeAssignmentId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        return assignments
            .Select(a => PracticeSummaryFactory.Build(
                a,
                paperById.GetValueOrDefault(a.PaperId),
                tagNameById,
                usedByPractice.GetValueOrDefault(a.Id),
                now))
            .ToList();
    }
}
