using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>修改标签。父标签、难度层级都可调整，但难度维度始终无父。</summary>
public sealed record UpdateTagCommand(
    long Id,
    string Name,
    long? ParentId,
    int? Level,
    string? Description,
    int SortOrder) : IAppCommand<TagDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagWrite];
}

public sealed class UpdateTagCommandValidator : AbstractValidator<UpdateTagCommand>
{
    public UpdateTagCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("标签 ID 不合法。");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写标签名称。")
            .MaximumLength(Tag.MaxNameLength).WithMessage($"标签名称长度不能超过 {Tag.MaxNameLength} 位。");

        RuleFor(x => x.Description)
            .MaximumLength(Tag.MaxDescriptionLength)
            .WithMessage($"标签说明长度不能超过 {Tag.MaxDescriptionLength} 位。");
    }
}

public sealed class UpdateTagHandler : IRequestHandler<UpdateTagCommand, TagDto>
{
    private readonly ITagRepository _tags;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateTagHandler(ITagRepository tags, IClock clock, ICurrentUser currentUser)
    {
        _tags = tags;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<TagDto> Handle(UpdateTagCommand request, CancellationToken cancellationToken)
    {
        var tag = await _tags.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new BusinessRuleException("标签不存在。");

        var now = _clock.UtcNow;
        var actorId = _currentUser.UserId;

        tag.Rename(request.Name, now, actorId);
        tag.ChangeDescription(request.Description, now, actorId);
        tag.SetSortOrder(request.SortOrder, now, actorId);

        if (tag.Group == TagGroup.Difficulty)
        {
            if (request.ParentId is not null)
            {
                throw new BusinessRuleException("难度维度的标签没有层级关系。");
            }

            tag.SetLevel(request.Level, now, actorId);
        }
        else
        {
            tag.SetLevel(null, now, actorId);
            await ApplyParentAsync(tag, request.ParentId, now, actorId, cancellationToken);
        }

        _tags.Update(tag);
        return TagDto.From(tag);
    }

    private async Task ApplyParentAsync(
        Tag tag,
        long? parentId,
        DateTimeOffset now,
        long? actorId,
        CancellationToken cancellationToken)
    {
        if (parentId is null)
        {
            tag.SetParent(null, now, actorId);
            return;
        }

        if (parentId == tag.Id)
        {
            throw new TagCycleException("标签不能以自身为父标签。");
        }

        var parent = await _tags.GetByIdAsync(parentId.Value, cancellationToken)
            ?? throw new BusinessRuleException("父标签不存在。");

        if (parent.Group != tag.Group)
        {
            throw new BusinessRuleException($"父标签必须与当前标签属于同一维度（{tag.Group.Label()}）。");
        }

        // 父标签若在自己的后代中，改挂会形成环。
        var descendants = await _tags.GetDescendantIdsAsync(tag.Id, includeSelf: true, cancellationToken);
        if (descendants.Contains(parent.Id))
        {
            throw new TagCycleException("该调整会让标签层级形成环。");
        }

        tag.SetParent(parent, now, actorId);
    }
}
