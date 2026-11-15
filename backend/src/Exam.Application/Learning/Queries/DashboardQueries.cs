using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Learning.Queries;

/// <summary>
/// 学生工作台汇总。
/// <para>
/// 一次给全：待完成练习、进行中的考试、学期平均分、待清理错题、推荐练习、
/// 最近成绩、成绩趋势与错题分布——前端不用为一块图发一次请求。
/// </para>
/// </summary>
public sealed record GetDashboardSummaryQuery()
    : IAppQuery<DashboardSummaryResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetDashboardSummaryHandler
    : IRequestHandler<GetDashboardSummaryQuery, DashboardSummaryResponse>
{
    private readonly DashboardService _dashboard;
    private readonly ICurrentUser _currentUser;

    public GetDashboardSummaryHandler(DashboardService dashboard, ICurrentUser currentUser)
    {
        _dashboard = dashboard;
        _currentUser = currentUser;
    }

    public async Task<DashboardSummaryResponse> Handle(
        GetDashboardSummaryQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        return await _dashboard.BuildAsync(userId, cancellationToken);
    }
}
