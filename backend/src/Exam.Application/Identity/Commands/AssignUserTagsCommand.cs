using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>覆盖式设置用户挂载的组织维度标签。</summary>
public sealed record AssignUserTagsCommand(long UserId, IReadOnlyList<long> TagIds)
    : IAppCommand<UserTagsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserTagAssign];
}

public sealed class AssignUserTagsCommandValidator : AbstractValidator<AssignUserTagsCommand>
{
    public AssignUserTagsCommandValidator()
    {
        RuleFor(x => x.UserId).GreaterThan(0).WithMessage("用户 ID 不合法。");
    }
}

public sealed class AssignUserTagsHandler : IRequestHandler<AssignUserTagsCommand, UserTagsResponse>
{
    private readonly IUserRepository _users;
    private readonly IUserTagRepository _userTags;
    private readonly ITagRepository _tags;
    private readonly UserOrganizationResolver _organization;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AssignUserTagsHandler(
        IUserRepository users,
        IUserTagRepository userTags,
        ITagRepository tags,
        UserOrganizationResolver organization,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _userTags = userTags;
        _tags = tags;
        _organization = organization;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<UserTagsResponse> Handle(AssignUserTagsCommand request, CancellationToken cancellationToken)
    {
        var user = await _users.GetByIdAsync(request.UserId, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        var requestedIds = request.TagIds.Distinct().ToList();
        var tags = await _tags.GetByIdsAsync(requestedIds, cancellationToken);

        var found = tags.Select(t => t.Id).ToHashSet();
        var missing = requestedIds.Where(id => !found.Contains(id)).ToArray();
        if (missing.Length > 0)
        {
            throw new BusinessRuleException($"存在未知标签：{string.Join("、", missing)}。");
        }

        // 只接受组织维度的标签——领域层规则。
        user.AssignTags(tags, [], _clock.UtcNow, _currentUser.UserId);

        var links = await _userTags.GetByUserAsync(user.Id, cancellationToken);
        var currentIds = links.Select(l => l.TagId).ToHashSet();
        var targetIds = requestedIds.ToHashSet();

        foreach (var link in links.Where(l => !targetIds.Contains(l.TagId)))
        {
            _userTags.Remove(link);
        }

        var now = _clock.UtcNow;
        foreach (var tagId in targetIds.Where(id => !currentIds.Contains(id)))
        {
            await _userTags.AddAsync(UserTag.Create(user.Id, tagId, now), cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "user.assign-tags",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?> { ["tagIds"] = targetIds.ToArray() },
            cancellationToken);

        return await _organization.ResolveAsync(user.Id, cancellationToken);
    }
}
