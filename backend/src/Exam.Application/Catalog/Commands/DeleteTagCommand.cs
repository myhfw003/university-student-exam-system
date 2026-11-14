using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>删除标签（软删除）。被引用或存在子标签时拒绝。</summary>
public sealed record DeleteTagCommand(long Id) : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagWrite];
}

public sealed class DeleteTagCommandValidator : AbstractValidator<DeleteTagCommand>
{
    public DeleteTagCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("标签 ID 不合法。");
    }
}

public sealed class DeleteTagHandler : IRequestHandler<DeleteTagCommand, Unit>
{
    private readonly ITagRepository _tags;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public DeleteTagHandler(ITagRepository tags, IClock clock, ICurrentUser currentUser)
    {
        _tags = tags;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(DeleteTagCommand request, CancellationToken cancellationToken)
    {
        var tag = await _tags.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new BusinessRuleException("标签不存在。");

        var hasChildren = await _tags.CountChildrenAsync(tag.Id, cancellationToken) > 0;
        tag.EnsureDeletable(hasChildren, usedByUsers: false, usedByQuestions: false);

        tag.SoftDelete(_clock.UtcNow, _currentUser.UserId);
        _tags.Update(tag);

        return Unit.Value;
    }
}
