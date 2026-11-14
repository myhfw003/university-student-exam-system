using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 批量保存答案。
/// <para>
/// 同一批 `clientSeq` 重复提交整体忽略（幂等），不会产生重复记录。
/// </para>
/// </summary>
public sealed record SaveAnswersCommand(long AttemptId, SaveAnswersInput Input)
    : IAppCommand<SaveAnswersResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class SaveAnswersCommandValidator : AbstractValidator<SaveAnswersCommand>
{
    /// <summary>单批上限。</summary>
    public const int MaxBatchSize = 50;

    public SaveAnswersCommandValidator()
    {
        RuleFor(x => x.AttemptId).GreaterThan(0);
        RuleFor(x => x.Input.ClientSeq).GreaterThan(0).WithMessage("客户端序列号必须大于 0。");
        RuleFor(x => x.Input.Items)
            .NotNull()
            .Must(items => items.Count <= MaxBatchSize)
            .WithMessage($"单批最多保存 {MaxBatchSize} 条答案。");
    }
}

public sealed class SaveAnswersHandler : IRequestHandler<SaveAnswersCommand, SaveAnswersResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IAnswerRevisionRepository _revisions;
    private readonly AttemptPaperResolver _resolver;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SaveAnswersHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IAnswerRevisionRepository revisions,
        AttemptPaperResolver resolver,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _answers = answers;
        _revisions = revisions;
        _resolver = resolver;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<SaveAnswersResponse> Handle(
        SaveAnswersCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能保存自己的作答。");
        }

        var paper = await _resolver.ResolveAsync(attempt, cancellationToken);

        // 场次被取消才停；练习没有场次，不受这一条约束。
        if (paper.Session is { Status: ExamSessionStatus.Cancelled })
        {
            throw new BusinessRuleException("场次已取消，不能继续作答。");
        }

        var now = _clock.UtcNow;

        // 超时或已交卷都会在这里被拒；超时的错误码 25002，HTTP 409。
        attempt.EnsureAcceptingAnswers(now);

        // 幂等：序列号没有前进就整批忽略。
        if (request.Input.ClientSeq <= attempt.LastClientSeq)
        {
            return new SaveAnswersResponse(
                attempt.LastClientSeq,
                now,
                attempt.RemainingSeconds(now),
                []);
        }

        var snapshot = paper.Snapshot;

        var itemsByQuestion = snapshot.Items.ToDictionary(i => i.QuestionId);
        var rejected = new List<RejectedAnswerDto>();
        var accepted = new List<AnswerUpsertValue>();

        foreach (var item in request.Input.Items)
        {
            if (!itemsByQuestion.TryGetValue(item.QuestionId, out var snapshotItem))
            {
                rejected.Add(new RejectedAnswerDto(item.QuestionId, "题目不在本场考试的卷面里。"));
                continue;
            }

            var payload = item.Payload.ToPayload();
            var reason = Validate(snapshotItem, payload);
            if (reason is not null)
            {
                rejected.Add(new RejectedAnswerDto(item.QuestionId, reason));
                continue;
            }

            accepted.Add(new AnswerUpsertValue(
                item.QuestionId,
                null,
                payload,
                payload.IsEmpty,
                request.Input.ClientSeq,
                now));
        }

        // 修订序号：已有答案 +1，新答案为 1。
        var existing = await _answers.ListByQuestionsAsync(
            attempt.Id,
            accepted.Select(a => a.QuestionId).ToList(),
            cancellationToken);
        var nextRevision = existing.ToDictionary(a => a.QuestionId, a => a.Revision + 1);

        await _answers.UpsertRangeAsync(attempt.Id, accepted, cancellationToken);

        // 流水只追加：事后能完整还原答案的演变过程。
        await _revisions.AddRangeAsync(
            accepted
                .Select(a => AnswerRevision.Create(
                    attempt.Id,
                    a.QuestionId,
                    request.Input.ClientSeq,
                    a.Payload,
                    nextRevision.GetValueOrDefault(a.QuestionId, 1),
                    request.Input.ClientSentAt,
                    now))
                .ToList(),
            cancellationToken);

        if (!attempt.AcceptSave(request.Input.ClientSeq, now))
        {
            // 期间有别的请求推进了序列号，这批直接忽略。
            return new SaveAnswersResponse(
                attempt.LastClientSeq,
                now,
                attempt.RemainingSeconds(now),
                rejected);
        }

        _attempts.Update(attempt);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return new SaveAnswersResponse(
            attempt.LastClientSeq,
            now,
            attempt.RemainingSeconds(now),
            rejected);
    }

    /// <summary>按题型校验答案载荷。返回 null 表示通过。</summary>
    private static string? Validate(SnapshotItem item, AnswerPayload payload)
    {
        var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;

        switch (type)
        {
            case QuestionType.Single or QuestionType.Judge:
                if (payload.SelectedOptionKeys.Count > 1)
                {
                    return "单选题只能选一个选项。";
                }

                break;

            case QuestionType.Comprehensive:
                if (payload.Steps.Count == 0 && payload.SelectedOptionKeys.Count > 0)
                {
                    return "综合题必须按步骤作答。";
                }

                break;
        }

        var optionKeys = item.Options.Select(o => o.Key).ToHashSet(StringComparer.Ordinal);
        var unknown = payload.SelectedOptionKeys.Where(k => !optionKeys.Contains(k)).ToList();
        if (unknown.Count > 0)
        {
            return $"选项 {string.Join("、", unknown)} 不存在。";
        }

        return null;
    }
}
