using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>取回场次负责人。</summary>
public sealed record ListExamSessionAssignmentsQuery(long ExamSessionId)
    : IAppQuery<ExamSessionAssignmentListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamRead];
}

public sealed class ListExamSessionAssignmentsHandler
    : IRequestHandler<ListExamSessionAssignmentsQuery, ExamSessionAssignmentListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamSessionAssignmentRepository _assignments;
    private readonly IUserRepository _users;
    private readonly ExamAccessScope _scope;

    public ListExamSessionAssignmentsHandler(
        IExamSessionRepository sessions,
        IExamSessionAssignmentRepository assignments,
        IUserRepository users,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _assignments = assignments;
        _users = users;
        _scope = scope;
    }

    public async Task<ExamSessionAssignmentListResponse> Handle(
        ListExamSessionAssignmentsQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 范围之外不返回：没被指派的人看不到这份名单。
        var scope = await _scope.ResolveAsync(cancellationToken);
        if (!scope.CanSeeSession(session.Id))
        {
            throw new ForbiddenException("你没有查看该场次的权限。");
        }

        // 考生看得到场次，但负责人名单是内部信息：只给这场考试的工作人员。
        if (scope.Tier == AccessScopeTier.Student)
        {
            throw new ForbiddenException("只有这场考试的工作人员可以查看负责人名单。");
        }

        var assignments = await _assignments.ListBySessionAsync(session.Id, cancellationToken);
        var users = await _users.GetByIdsAsync(assignments.Select(a => a.UserId).ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        return new ExamSessionAssignmentListResponse(
            session.Id,
            assignments
                .Select(a =>
                {
                    var user = userById.GetValueOrDefault(a.UserId);
                    return ExamSessionAssignmentDtoFactory.ToDto(
                        a,
                        user?.Username ?? string.Empty,
                        user?.DisplayName ?? string.Empty);
                })
                .ToList(),
            assignments.Count);
    }
}
