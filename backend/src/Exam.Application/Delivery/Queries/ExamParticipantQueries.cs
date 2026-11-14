using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
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

    public ListExamParticipantsHandler(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IUserRepository users)
    {
        _sessions = sessions;
        _participants = participants;
        _users = users;
    }

    public async Task<ExamParticipantListResponse> Handle(
        ListExamParticipantsQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var participants = await _participants.ListBySessionAsync(session.Id, cancellationToken);
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
