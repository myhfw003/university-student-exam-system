using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>按维度分组返回全部标签（含引用计数）。</summary>
public sealed record GetTagsQuery(string? Group) : IAppQuery<TagGroupsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagRead];
}

public sealed class GetTagsHandler : IRequestHandler<GetTagsQuery, TagGroupsResponse>
{
    private readonly ITagRepository _tags;

    public GetTagsHandler(ITagRepository tags) => _tags = tags;

    public async Task<TagGroupsResponse> Handle(GetTagsQuery request, CancellationToken cancellationToken)
    {
        var group = string.IsNullOrWhiteSpace(request.Group) ? null : TagGroups.FromStorage(request.Group);
        var tags = await _tags.ListAsync(group, cancellationToken);

        var groups = TagGroups.All
            .Select(g => new TagGroupDto(
                g.ToStorage(),
                g.Label(),
                g.AllowsHierarchy(),
                g.AppliesToQuestions(),
                g.AppliesToUsers(),
                tags.Where(t => t.Group == g).Select(TagDto.From).ToList()))
            .Where(g => g.Tags.Count > 0)
            .ToList();

        return new TagGroupsResponse(groups);
    }
}
