using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Delivery.Services;

/// <summary>访问范围档位。</summary>
public enum AccessScopeTier
{
    /// <summary>全局管理者：系统管理员与内容管理员，看得到全部场次与试卷。</summary>
    Manager,

    /// <summary>出题与阅卷人员：只看自己负责的场次——自己建的、自己出的卷子挂的、被指派阅卷的。</summary>
    Staff,

    /// <summary>考生：只看自己参加的场次，以及全员开放已发布的场次。</summary>
    Student,
}

/// <summary>
/// 可见范围快照。
/// <para>
/// 对象级范围只看三样已有的事实：谁建的场次、谁出的卷子、谁被指派了阅卷任务。
/// 名单物化后的考生身份决定考生能看见哪些场次。
/// </para>
/// </summary>
public sealed record AccessScope(
    AccessScopeTier Tier,
    long UserId,
    IReadOnlySet<long> SessionIds,
    IReadOnlySet<long> PaperIds)
{
    public bool CanSeeSession(long sessionId) =>
        Tier == AccessScopeTier.Manager || SessionIds.Contains(sessionId);

    public bool CanSeePaper(long paperId) =>
        Tier == AccessScopeTier.Manager || PaperIds.Contains(paperId);
}

/// <summary>
/// 对象级可见范围解析。
/// <para>
/// 权限码回答「这类操作能不能做」，本服务回答「这条数据能不能看」。
/// 没有数据支撑的范围不猜：阅卷教师负责的场次以**被指派的阅卷任务**为准，
/// 出题教师以**自己创建的试卷**为准，考生以**名单物化记录**为准。
/// </para>
/// </summary>
public sealed class ExamAccessScope
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IPaperRepository _papers;
    private readonly IReviewTaskRepository _reviewTasks;
    private readonly IExamSessionAssignmentRepository _assignments;
    private readonly PracticeVisibilityResolver _practices;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ExamAccessScope(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IPaperRepository papers,
        IReviewTaskRepository reviewTasks,
        IExamSessionAssignmentRepository assignments,
        PracticeVisibilityResolver practices,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _participants = participants;
        _papers = papers;
        _reviewTasks = reviewTasks;
        _assignments = assignments;
        _practices = practices;
        _clock = clock;
        _currentUser = currentUser;
    }

    /// <summary>解析当前调用者的可见范围。</summary>
    public async Task<AccessScope> ResolveAsync(CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId ?? throw new ForbiddenException("请先登录。");

        // 全局管理者：能管用户（系统管理员、内容管理员）。
        if (_currentUser.HasPermission(PermissionCatalog.UserWrite))
        {
            return new AccessScope(AccessScopeTier.Manager, userId, new HashSet<long>(), new HashSet<long>());
        }

        var isStaff =
            _currentUser.HasPermission(PermissionCatalog.ExamWrite)
            || _currentUser.HasPermission(PermissionCatalog.PaperWrite)
            || _currentUser.HasPermission(PermissionCatalog.AttemptReadAll)
            || _currentUser.HasPermission(PermissionCatalog.ProctorMonitor)
            || _currentUser.HasPermission(PermissionCatalog.ReviewGrade);

        var tier = isStaff ? AccessScopeTier.Staff : AccessScopeTier.Student;
        var sessionIds = new HashSet<long>();
        var paperIds = new HashSet<long>();

        // 自己建的场次。
        foreach (var session in await _sessions.ListByCreatorAsync(userId, cancellationToken))
        {
            sessionIds.Add(session.Id);
        }

        // 自己出的卷子（出题教师的范围），以及挂在这些卷子下的场次。
        var myPapers = await _papers.ListByCreatorAsync(userId, cancellationToken);
        foreach (var paper in myPapers)
        {
            paperIds.Add(paper.Id);
        }

        if (myPapers.Count > 0)
        {
            foreach (var session in await _sessions.ListByPaperIdsAsync(
                myPapers.Select(p => p.Id).ToList(),
                cancellationToken))
            {
                sessionIds.Add(session.Id);
            }
        }

        // 被指派为这场考试负责人的场次（阅卷教师、监考人员的「所负责场次」）。
        foreach (var sessionId in await _assignments.ListSessionIdsByUserAsync(userId, cancellationToken))
        {
            sessionIds.Add(sessionId);
        }

        // 被指派的阅卷任务所在的场次（阅卷教师负责的场次）。
        if (_currentUser.HasPermission(PermissionCatalog.ReviewGrade))
        {
            var tasks = await _reviewTasks.SearchAsync(
                new ReviewTaskSearchCriteria { AssigneeId = userId },
                0,
                1000,
                cancellationToken);

            foreach (var sessionId in tasks
                .Where(t => t.ExamSessionId is not null)
                .Select(t => t.ExamSessionId!.Value))
            {
                sessionIds.Add(sessionId);
            }
        }

        if (tier == AccessScopeTier.Student)
        {
            // 考生：名单物化记录 + 全员开放已发布的场次。
            foreach (var sessionId in await _participants.ListSessionIdsByUserAsync(userId, cancellationToken))
            {
                sessionIds.Add(sessionId);
            }

            foreach (var session in await _sessions.ListOpenToAllPublishedAsync(cancellationToken))
            {
                sessionIds.Add(session.Id);
            }
        }

        // 可见场次对应的试卷。
        if (sessionIds.Count > 0)
        {
            var visibleSessions = await _sessions.GetByIdsAsync(sessionIds.ToList(), cancellationToken);
            foreach (var paperId in visibleSessions.Select(s => s.PaperId))
            {
                paperIds.Add(paperId);
            }
        }

        // 练习挂的试卷（练习按标签划范围，另有判定）。
        var visiblePractices = await _practices.ListVisibleAsync(userId, _clock.UtcNow, cancellationToken);
        foreach (var paperId in visiblePractices.Select(p => p.PaperId))
        {
            paperIds.Add(paperId);
        }

        return new AccessScope(tier, userId, sessionIds, paperIds);
    }

    /// <summary>场次不可见时抛出 403。</summary>
    public async Task EnsureSessionVisibleAsync(long sessionId, CancellationToken cancellationToken = default)
    {
        var scope = await ResolveAsync(cancellationToken);
        if (!scope.CanSeeSession(sessionId))
        {
            throw new ForbiddenException("你没有查看该场次的权限。");
        }
    }

    /// <summary>
    /// 这份作答能不能看。
    /// <para>
    /// 本人的作答当然能看；别人的作答要求调用者在该场次的可见范围内，
    /// 或者被指派了这份作答上的阅卷任务。
    /// </para>
    /// </summary>
    public async Task EnsureAttemptVisibleAsync(Attempt attempt, CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId ?? throw new ForbiddenException("请先登录。");

        // 本人的作答：直接放行，不查范围（作答保存是热路径）。
        if (attempt.UserId == userId)
        {
            return;
        }

        // 看别人的作答要 attempt:read-all：被指派只界定「哪些场次」，不授予权限。
        if (!_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("你没有查看该作答的权限。");
        }

        var scope = await ResolveAsync(cancellationToken);

        if (scope.Tier == AccessScopeTier.Manager)
        {
            return;
        }

        // 考生：只看得到自己的作答。看得见场次不等于看得见同场考生的作答。
        if (scope.Tier == AccessScopeTier.Student)
        {
            throw new ForbiddenException("你没有查看该作答的权限。");
        }

        // 教职人员：场次在自己负责的范围内才看得见这份作答。
        if (attempt.ExamSessionId is { } sessionId && scope.SessionIds.Contains(sessionId))
        {
            return;
        }

        if (_currentUser.HasPermission(PermissionCatalog.ReviewGrade)
            && await HasAssignedReviewTaskAsync(attempt.Id, userId, cancellationToken))
        {
            return;
        }

        throw new ForbiddenException("你没有查看该作答的权限。");
    }

    /// <summary>我是否被指派了这份作答上的阅卷任务。</summary>
    private async Task<bool> HasAssignedReviewTaskAsync(
        long attemptId,
        long userId,
        CancellationToken cancellationToken)
    {
        var tasks = await _reviewTasks.SearchAsync(
            new ReviewTaskSearchCriteria { AssigneeId = userId },
            0,
            1000,
            cancellationToken);

        return tasks.Any(t => t.AttemptId == attemptId);
    }

    /// <summary>试卷不可见时抛出 403。</summary>
    public async Task EnsurePaperVisibleAsync(long paperId, CancellationToken cancellationToken = default)
    {
        var scope = await ResolveAsync(cancellationToken);
        if (!scope.CanSeePaper(paperId))
        {
            throw new ForbiddenException("你没有查看该试卷的权限。");
        }
    }
}
