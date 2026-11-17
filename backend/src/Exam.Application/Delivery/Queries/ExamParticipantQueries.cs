using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>取回场次名单。</summary>
public sealed record ListExamParticipantsQuery(long ExamSessionId)
    : IAppQuery<ExamParticipantListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamRead];
}

public sealed class ListExamParticipantsHandler : IRequestHandler<ListExamParticipantsQuery, ExamParticipantListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IUserRepository _users;
    private readonly ICurrentUser _currentUser;
    private readonly ExamAccessScope _scope;

    public ListExamParticipantsHandler(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IUserRepository users,
        ICurrentUser currentUser,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _participants = participants;
        _users = users;
        _currentUser = currentUser;
        _scope = scope;
    }

    public async Task<ExamParticipantListResponse> Handle(
        ListExamParticipantsQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        await _scope.EnsureSessionVisibleAsync(session.Id, cancellationToken);

        var participants = await _participants.ListBySessionAsync(session.Id, cancellationToken);

        // 考生只看得到自己那条名单记录：整场名单是同场考生的信息。
        var scope = await _scope.ResolveAsync(cancellationToken);
        if (scope.Tier == AccessScopeTier.Student)
        {
            var userId = _currentUser.UserId ?? throw new ForbiddenException("请先登录。");
            participants = participants.Where(p => p.UserId == userId).ToList();
        }
        var users = await _users.GetByIdsAsync(participants.Select(p => p.UserId).ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        return new ExamParticipantListResponse(
            session.Id,
            session.ParticipantMode.ToStorage(),
            session.ParticipantMode.Label(),
            participants
                .Select(p =>
                {
                    var user = userById.GetValueOrDefault(p.UserId);
                    return ExamParticipantDtoFactory.ToDto(p, user?.Username ?? string.Empty, user?.DisplayName ?? string.Empty);
                })
                .ToList(),
            participants.Count);
    }
}
