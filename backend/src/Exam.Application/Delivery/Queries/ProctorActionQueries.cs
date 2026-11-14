using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>某次作答的监考处置历史。</summary>
public sealed record ListProctorActionsQuery(long AttemptId)
    : IAppQuery<ProctorActionListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ProctorMonitor];
}

public sealed class ListProctorActionsHandler : IRequestHandler<ListProctorActionsQuery, ProctorActionListResponse>
{
    private readonly IProctorActionRepository _actions;
    private readonly IAttemptRepository _attempts;
    private readonly IUserRepository _users;

    public ListProctorActionsHandler(
        IProctorActionRepository actions,
        IAttemptRepository attempts,
        IUserRepository users)
    {
        _actions = actions;
        _attempts = attempts;
        _users = users;
    }

    public async Task<ProctorActionListResponse> Handle(
        ListProctorActionsQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var actions = await _actions.ListByAttemptAsync(attempt.Id, cancellationToken);
        var operators = await _users.GetByIdsAsync(actions.Select(a => a.OperatorId).Distinct().ToList(), cancellationToken);
        var operatorNames = operators.ToDictionary(u => u.Id, u => u.DisplayName);

        var items = actions
            .Select(a => new ProctorActionDto(
                a.Id,
                a.AttemptId,
                a.ActionType.ToStorage(),
                a.Message,
                a.Reason,
                operatorNames.GetValueOrDefault(a.OperatorId, string.Empty),
                a.CreatedAt))
            .ToList();

        return new ProctorActionListResponse(attempt.Id, items, items.Count);
    }
}
