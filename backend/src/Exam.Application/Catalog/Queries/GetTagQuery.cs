using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Application.Common.Exceptions;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>取回单个标签及其直接子标签。</summary>
public sealed record GetTagQuery(long Id) : IAppQuery<TagDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagRead];
}

public sealed class GetTagHandler : IRequestHandler<GetTagQuery, TagDetailDto>
{
    private readonly ITagRepository _tags;

    public GetTagHandler(ITagRepository tags) => _tags = tags;

    public async Task<TagDetailDto> Handle(GetTagQuery request, CancellationToken cancellationToken)
    {
        var tag = await _tags.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("标签不存在。");

        var children = await _tags.GetChildrenAsync(tag.Id, cancellationToken);

        return new TagDetailDto(TagDto.From(tag), children.Select(TagDto.From).ToList());
    }
}

/// <summary>展开标签的全部后代。用于"选高等数学能命中其下所有知识点"。</summary>
public sealed record GetTagDescendantsQuery(long Id, bool IncludeSelf)
    : IAppQuery<TagDescendantsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagRead];
}

public sealed class GetTagDescendantsHandler : IRequestHandler<GetTagDescendantsQuery, TagDescendantsResponse>
{
    private readonly ITagRepository _tags;

    public GetTagDescendantsHandler(ITagRepository tags) => _tags = tags;

    public async Task<TagDescendantsResponse> Handle(
        GetTagDescendantsQuery request,
        CancellationToken cancellationToken)
    {
        var root = await _tags.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("标签不存在。");

        var ids = await _tags.GetDescendantIdsAsync(root.Id, request.IncludeSelf, cancellationToken);
        var tags = await _tags.GetByIdsAsync(ids, cancellationToken);

        return new TagDescendantsResponse(root.Id, ids, tags.Select(TagDto.From).ToList());
    }
}
