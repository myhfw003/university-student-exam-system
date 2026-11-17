using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 设置场次负责人（覆盖式）。
/// <para>
/// 阅卷教师与监考人员「限所负责场次」的事实依据：指派谁，谁就看这场考试的全部作答、
/// 成绩与监考数据。指派不授予权限，被指派的人仍要有对应的权限点。
/// </para>
/// </summary>
public sealed record SetExamSessionAssignmentsCommand(long ExamSessionId, IReadOnlyList<long> UserIds)
    : IAppCommand<ExamSessionAssignmentListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class SetExamSessionAssignmentsHandler
    : IRequestHandler<SetExamSessionAssignmentsCommand, ExamSessionAssignmentListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamSessionAssignmentRepository _assignments;
    private readonly IUserRepository _users;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SetExamSessionAssignmentsHandler(
        IExamSessionRepository sessions,
        IExamSessionAssignmentRepository assignments,
        IUserRepository users,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _assignments = assignments;
        _users = users;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionAssignmentListResponse> Handle(
        SetExamSessionAssignmentsCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var userIds = request.UserIds.Where(id => id > 0).Distinct().ToList();

        // 指派给谁必须是真实存在的账号：否则这条指派永远没有主人。
        var users = await _users.GetByIdsAsync(userIds, cancellationToken);
        var missing = userIds.Except(users.Select(u => u.Id)).ToList();
        if (missing.Count > 0)
        {
            throw new BusinessRuleException(
                $"指派的用户不存在：{string.Join("、", missing)}。",
                new Dictionary<string, string[]>(StringComparer.Ordinal)
                {
                    ["userIds"] = ["指派列表里有不存在的账号。"],
                });
        }

        var now = _clock.UtcNow;

        // 覆盖式：按差集增删。已经在名单里的人不动，
        // 免得同一次保存里先插后删撞上唯一索引。
        var existing = await _assignments.ListBySessionAsync(session.Id, cancellationToken);
        var existingUserIds = existing.Select(a => a.UserId).ToHashSet();

        await _assignments.DeleteExceptAsync(session.Id, userIds, cancellationToken);
        await _assignments.AddRangeAsync(
            userIds
                .Where(userId => !existingUserIds.Contains(userId))
                .Select(userId => ExamSessionAssignment.Create(session.Id, userId, now, _currentUser.UserId))
                .ToList(),
            cancellationToken);

        await _audit.RecordAsync(
            "exam_session.set_assignments",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?> { ["userIds"] = userIds },
            cancellationToken);

        // 先落库再回读，否则读到的还是旧指派。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var items = await _assignments.ListBySessionAsync(session.Id, cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        return new ExamSessionAssignmentListResponse(
            session.Id,
            items
                .Select(a =>
                {
                    var user = userById.GetValueOrDefault(a.UserId);
                    return ExamSessionAssignmentDtoFactory.ToDto(
                        a,
                        user?.Username ?? string.Empty,
                        user?.DisplayName ?? string.Empty);
                })
                .ToList(),
            items.Count);
    }
}
