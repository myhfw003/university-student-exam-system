using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Learning.Commands;

/// <summary>
/// 单题重做：把这道题做成一份只有一道题的练习，并直接开好会话。
/// <para>
/// 重做答对之后，这道题就不再是错题——错题本会把它移出去。
/// </para>
/// </summary>
public sealed record RedoMistakeCommand(long QuestionId)
    : IAppCommand<RedoMistakeResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class RedoMistakeHandler : IRequestHandler<RedoMistakeCommand, RedoMistakeResponse>
{
    /// <summary>
    /// 练习的兜底期限（分钟）。练习本身不强制交卷，这里只是给个宽松的截止时间。
    /// </summary>
    private const int PracticeFallbackMinutes = 1440;

    private readonly IMistakeRepository _mistakes;
    private readonly IQuestionRepository _questions;
    private readonly IPaperRepository _papers;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IPracticeAssignmentRepository _practiceAssignments;
    private readonly IAttemptRepository _attempts;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public RedoMistakeHandler(
        IMistakeRepository mistakes,
        IQuestionRepository questions,
        IPaperRepository papers,
        IPaperSnapshotRepository snapshots,
        IPracticeAssignmentRepository practiceAssignments,
        IAttemptRepository attempts,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _mistakes = mistakes;
        _questions = questions;
        _papers = papers;
        _snapshots = snapshots;
        _practiceAssignments = practiceAssignments;
        _attempts = attempts;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<RedoMistakeResponse> Handle(
        RedoMistakeCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var mistake = await _mistakes.GetAsync(userId, request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("错题本里没有这道题。");

        var question = await _questions.GetByIdAsync(request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        if (question.Status != QuestionStatus.Published)
        {
            throw new BusinessRuleException("题目已停用，不能重做。");
        }

        var now = _clock.UtcNow;
        var title = $"错题重做：{question.Code}";

        // 一道题就是一份卷子。
        var paper = Paper.CreateDraft(PaperKind.Practice, title, now, userId);
        paper.AddItem(question, question.DefaultScore, sortOrder: 0, now: now, actorId: userId);
        await _papers.AddAsync(paper, cancellationToken);

        // 先落库拿到试卷主键，快照才挂得上。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 发布即冻结：生成快照，卷面才不会跟着题目改动。
        var snapshot = PaperSnapshot.Create(paper, [question], version: 1, now: now, actorId: userId);
        await _snapshots.AddAsync(snapshot, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        paper.Publish(snapshot.Id, now, userId);
        _papers.Update(paper);

        var assignment = PracticeAssignment.Create(
            paper.Id,
            title,
            scopeTagIds: [],
            openAt: now,
            closeAt: null,
            now: now,
            actorId: userId);

        assignment.Publish(now, userId);
        await _practiceAssignments.AddAsync(assignment, cancellationToken);

        // 先落库拿到练习单主键，作答会话才挂得上。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var used = (await _attempts.ListByUserAsync(userId, cancellationToken))
            .Count(a => a.PracticeAssignmentId == assignment.Id);

        var attempt = Attempt.CreatePractice(
            assignment.Id,
            userId,
            used + 1,
            variantKey: PaperVariantBuilder.StandardVariantKey,
            variantSeed: null,
            now: now,
            actorId: userId);

        attempt.Start(now, PracticeFallbackMinutes, now.AddMinutes(PracticeFallbackMinutes));
        await _attempts.AddAsync(attempt, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "mistake.redo",
            "mistake",
            mistake.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["userId"] = userId,
                ["questionId"] = question.Id,
                ["practiceAssignmentId"] = assignment.Id,
                ["attemptId"] = attempt.Id,
            },
            cancellationToken);

        return new RedoMistakeResponse(
            assignment.Id,
            attempt.Id,
            question.Id,
            question.Code,
            question.Type.ToStorage(),
            title,
            attempt.DeadlineAt);
    }
}
