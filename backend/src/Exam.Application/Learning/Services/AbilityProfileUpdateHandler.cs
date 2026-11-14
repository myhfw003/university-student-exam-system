using Exam.Application.Common.Interfaces;
using Exam.Application.Messaging;
using Exam.Domain.Catalog;
using Exam.Domain.Grading.Events;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 能力画像更新。
/// <para>
/// 成绩定分就更新：只认能力维度的标签，样本来自这个人在这些题上的已定分成绩。
/// </para>
/// </summary>
public sealed class AbilityProfileUpdateHandler : IDomainEventHandler<ScoreFinalized>
{
    private readonly IAbilityProfileRepository _profiles;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IAttemptRepository _attempts;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IClock _clock;

    public AbilityProfileUpdateHandler(
        IAbilityProfileRepository profiles,
        IScoreResultRepository scoreResults,
        IAttemptRepository attempts,
        IQuestionRepository questions,
        ITagRepository tags,
        IClock clock)
    {
        _profiles = profiles;
        _scoreResults = scoreResults;
        _attempts = attempts;
        _questions = questions;
        _tags = tags;
        _clock = clock;
    }

    public async Task HandleAsync(ScoreFinalized domainEvent, CancellationToken cancellationToken = default)
    {
        var attempt = await _attempts.GetByIdAsync(domainEvent.AttemptId, cancellationToken);
        if (attempt is null)
        {
            return;
        }

        var question = await _questions.GetByIdAsync(domainEvent.QuestionId, cancellationToken);
        if (question is null || question.TagIds.Count == 0)
        {
            return;
        }

        // 只认能力维度的标签：知识点标签不进能力画像。
        var tags = await _tags.GetByIdsAsync(question.TagIds.ToList(), cancellationToken);
        var abilityTagIds = tags
            .Where(t => t.Group == TagGroup.Ability)
            .Select(t => t.Id)
            .ToList();

        if (abilityTagIds.Count == 0)
        {
            return;
        }

        var now = _clock.UtcNow;

        foreach (var abilityTagId in abilityTagIds)
        {
            var results = await _scoreResults.ListFinalByUserAndTagAsync(
                attempt.UserId,
                abilityTagId,
                cancellationToken);

            var samples = results
                .Select(r => new MasterySample(
                    r.MaxScore.Value > 0m ? r.Score.Value / r.MaxScore.Value : 0m,
                    r.MaxScore.Value))
                .ToList();

            var mastery = MasteryCalculator.Calculate(samples);
            var correctCount = samples.Count(s => s.Rate >= 1m);

            var profile = await _profiles.GetAsync(attempt.UserId, abilityTagId, cancellationToken);
            if (profile is null)
            {
                await _profiles.AddAsync(
                    AbilityProfile.Record(attempt.UserId, abilityTagId, mastery, samples.Count, correctCount, now),
                    cancellationToken);
                continue;
            }

            profile.Update(mastery, samples.Count, correctCount, now);
            _profiles.Update(profile);
        }
    }
}
