using Exam.Application.Common.Interfaces;
using Exam.Application.Messaging;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading.Events;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 错题回流。
/// <para>
/// 成绩定分就回流：客观题判错、主观题最终分不满，都进错题本；
/// 主观题拿部分分也算错（要点没覆盖到）。
/// </para>
/// <para>
/// 同一次作答里的同一道题只记一次：改分不算又错一次。
/// </para>
/// </summary>
public sealed class MistakeWriteBackHandler : IDomainEventHandler<ScoreFinalized>
{
    private readonly IMistakeRepository _mistakes;
    private readonly IAttemptRepository _attempts;
    private readonly IQuestionRepository _questions;
    private readonly IAnswerRepository _answers;
    private readonly IClock _clock;

    public MistakeWriteBackHandler(
        IMistakeRepository mistakes,
        IAttemptRepository attempts,
        IQuestionRepository questions,
        IAnswerRepository answers,
        IClock clock)
    {
        _mistakes = mistakes;
        _attempts = attempts;
        _questions = questions;
        _answers = answers;
        _clock = clock;
    }

    public async Task HandleAsync(ScoreFinalized domainEvent, CancellationToken cancellationToken = default)
    {
        var attempt = await _attempts.GetByIdAsync(domainEvent.AttemptId, cancellationToken);
        if (attempt is null)
        {
            return;
        }

        var now = _clock.UtcNow;
        var existing = await _mistakes.GetAsync(attempt.UserId, domainEvent.QuestionId, cancellationToken);

        // 这次答对了：错题不再错——移出错题本。
        if (domainEvent.Score >= domainEvent.MaxScore)
        {
            existing?.Resolve(now);
            return;
        }

        var reason = await ClassifyAsync(domainEvent, cancellationToken);
        var sourceType = attempt.TargetType == AttemptTargetType.Practice
            ? MistakeSourceType.Practice
            : MistakeSourceType.Exam;

        if (existing is null)
        {
            await _mistakes.AddAsync(
                Mistake.Record(
                    attempt.UserId,
                    domainEvent.QuestionId,
                    reason,
                    sourceType,
                    attempt.Id,
                    now),
                cancellationToken);
            return;
        }

        if (existing.SourceAttemptId == attempt.Id)
        {
            // 同一次作答里改了分，不算又错一次：只更新错因。
            existing.RefreshReason(reason, sourceType, attempt.Id, now);
            _mistakes.Update(existing);
            return;
        }

        existing.RecordWrong(reason, sourceType, attempt.Id, now);
        _mistakes.Update(existing);
    }

    /// <summary>错因分类。</summary>
    private async Task<MistakeReason> ClassifyAsync(
        ScoreFinalized domainEvent,
        CancellationToken cancellationToken)
    {
        var answer = await _answers.GetAsync(domainEvent.AttemptId, domainEvent.QuestionId, cancellationToken);
        if (answer is null || answer.IsBlank)
        {
            return MistakeReason.Unanswered;
        }

        var question = await _questions.GetByIdAsync(domainEvent.QuestionId, cancellationToken);
        var type = question?.Type ?? QuestionType.Single;

        return type switch
        {
            // 多选：拿到分是漏选，一分没有是错选。
            QuestionType.Multi => domainEvent.Score > 0m
                ? MistakeReason.MultiMissed
                : MistakeReason.MultiWrong,
            QuestionType.Judge => MistakeReason.JudgeWrong,
            QuestionType.Comprehensive => MistakeReason.ComprehensiveStepMissed,
            QuestionType.Short => MistakeReason.ShortKeypointsMissed,
            _ => MistakeReason.SingleWrong,
        };
    }
}
