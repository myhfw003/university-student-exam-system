using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 设置场次名单（按组织标签）。
/// <para>场次已发布时立即重新物化名单，并留下审计记录。</para>
/// </summary>
public sealed record SetExamParticipantsCommand(long ExamSessionId, IReadOnlyList<long> ParticipantTagIds)
    : IAppCommand<ExamParticipantListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class SetExamParticipantsHandler : IRequestHandler<SetExamParticipantsCommand, ExamParticipantListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IUserRepository _users;
    private readonly ExamRosterBuilder _roster;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SetExamParticipantsHandler(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IUserRepository users,
        ExamRosterBuilder roster,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _participants = participants;
        _users = users;
        _roster = roster;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamParticipantListResponse> Handle(
        SetExamParticipantsCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 先展开一次，顺带校验标签是否合法。
        var userIds = await _roster.ResolveByTagsAsync(request.ParticipantTagIds, cancellationToken);

        var now = _clock.UtcNow;
        session.SetParticipantTags(request.ParticipantTagIds, now, _currentUser.UserId);
        _sessions.Update(session);

        // 已发布的场次立刻重新物化名单；未发布的等发布时再展开。
        if (session.Status == ExamSessionStatus.InProgress)
        {
            await _participants.DeleteBySessionAsync(session.Id, cancellationToken);
            await _participants.AddRangeAsync(
                userIds.Select(userId => ExamParticipant.Create(session.Id, userId, now)).ToList(),
                cancellationToken);
        }

        await _audit.RecordAsync(
            "exam_session.set_participants",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["participantTagIds"] = request.ParticipantTagIds,
                ["resolvedCount"] = userIds.Count,
            },
            cancellationToken);

        // 先落库再回读，否则读到的还是旧名单。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

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
