using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Application.Learning.Services;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>
/// 练习即时反馈。
/// <para>
/// 反馈时机由练习规则说了算：**immediate** 边做边看对错；**after_submit** 交卷后才给。
/// 考试不给反馈——考试进行中泄露答案等于没有考试。
/// </para>
/// </summary>
public sealed record GetAttemptFeedbackQuery(long AttemptId)
    : IAppQuery<AttemptFeedbackResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAttemptFeedbackHandler
    : IRequestHandler<GetAttemptFeedbackQuery, AttemptFeedbackResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly AttemptPaperResolver _resolver;
    private readonly AttemptScoringService _scoring;
    private readonly PracticeRulesResolver _practiceRules;
    private readonly ExamAccessScope _scope;
    private readonly ICurrentUser _currentUser;
    private readonly IClock _clock;

    public GetAttemptFeedbackHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        AttemptPaperResolver resolver,
        AttemptScoringService scoring,
        PracticeRulesResolver practiceRules,
        ICurrentUser currentUser,
        IClock clock,
        ExamAccessScope scope)
    {
        _scope = scope;
        _attempts = attempts;
        _answers = answers;
        _resolver = resolver;
        _scoring = scoring;
        _practiceRules = practiceRules;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<AttemptFeedbackResponse> Handle(
        GetAttemptFeedbackQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        await _scope.EnsureAttemptVisibleAsync(attempt, cancellationToken);

        if (attempt.TargetType != AttemptTargetType.Practice)
        {
            throw new BusinessRuleException("考试不提供即时反馈。");
        }

        var rules = await _practiceRules.ResolveAsync(attempt.PracticeAssignmentId!.Value, cancellationToken);
        var immediate = string.Equals(rules.FeedbackTiming, "immediate", StringComparison.OrdinalIgnoreCase);

        if (!immediate && !attempt.IsSubmitted)
        {
            throw new BusinessRuleException("本练习在提交后才提供反馈。");
        }

        var paper = await _resolver.ResolveAsync(attempt, cancellationToken);
        var scored = await _scoring.PreviewAsync(attempt, paper.Snapshot, paper.PaperItems, cancellationToken);
        var scoredByQuestion = scored.ToDictionary(s => s.QuestionId);

        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var answeredQuestionIds = answers.Where(a => !a.IsBlank).Select(a => a.QuestionId).ToHashSet();

        var questions = paper.Snapshot.Items
            .OrderBy(i => i.SortOrder)
            .Select(item =>
            {
                var outcome = scoredByQuestion.GetValueOrDefault(item.QuestionId)?.Outcome;
                var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;
                var answered = answeredQuestionIds.Contains(item.QuestionId);

                // 主观题没有「对错」这一说，只给参考分。
                bool? correct = type.IsObjective() && outcome is not null
                    ? outcome.Score >= outcome.MaxScore
                    : null;

                return new AttemptFeedbackQuestionDto(
                    item.QuestionId,
                    item.QuestionCode,
                    item.QuestionType,
                    type.Label(),
                    answered,
                    correct,
                    outcome?.Score ?? 0m,
                    outcome?.MaxScore ?? item.Score.Value,
                    type.IsObjective() ? item.CorrectKeys : [],
                    item.ReferenceAnswer,
                    item.Analysis,
                    outcome?.Details ?? []);
            })
            .ToList();

        return new AttemptFeedbackResponse(
            attempt.Id,
            rules.FeedbackTiming,
            _clock.UtcNow,
            questions);
    }
}
