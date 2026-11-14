using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Delivery.Services;

/// <summary>考生卷面（快照 + 置换）。</summary>
public sealed record AttemptPaperSurface(
    string VariantKey,
    string VariantSeed,
    IReadOnlyList<AttemptQuestionDto> Questions);

/// <summary>
/// 考生卷面构建（应用层服务）。
/// <para>
/// 卷面来自场次绑定的**已发布快照**，再按考生派生选项顺序；
/// **正确答案绝不下发**——考试进行中泄露答案等于没有考试。
/// </para>
/// </summary>
public sealed class AttemptPaperSurfaceBuilder
{
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly AttemptPaperResolver _resolver;

    public AttemptPaperSurfaceBuilder(
        IPaperSnapshotRepository snapshots,
        IQuestionRepository questions,
        ITagRepository tags,
        AttemptPaperResolver resolver)
    {
        _snapshots = snapshots;
        _questions = questions;
        _tags = tags;
        _resolver = resolver;
    }

    /// <summary>按作答解析卷面：考试走场次快照，练习走练习开放单挂的试卷。</summary>
    public async Task<AttemptPaperSurface> BuildForAttemptAsync(
        Attempt attempt,
        long userId,
        CancellationToken cancellationToken = default)
    {
        var context = await _resolver.ResolveAsync(attempt, cancellationToken);

        // 考试按场次的卷型置换；练习不置换——重做就是要看清原题。
        var variantRule = context.Session?.VariantRule ?? VariantRule.Standard;
        var seed = (context.Session?.Id ?? context.PracticeAssignment!.Id).ToString();

        return await BuildAsync(context.Snapshot, variantRule, userId, seed, cancellationToken);
    }

    /// <summary>按场次构建卷面（开始考试时用：会话还没建）。</summary>
    public async Task<AttemptPaperSurface> BuildForSessionAsync(
        ExamSession session,
        long userId,
        CancellationToken cancellationToken = default)
    {
        if (session.SnapshotId is null)
        {
            throw new BusinessRuleException("场次尚未绑定试卷快照，无法进入。");
        }

        var snapshot = await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken)
            ?? throw new NotFoundException("试卷快照不存在。");

        return await BuildAsync(snapshot, session.VariantRule, userId, session.Id.ToString(), cancellationToken);
    }

    public async Task<AttemptPaperSurface> BuildAsync(
        PaperSnapshot snapshot,
        VariantRule variantRule,
        long userId,
        string seed,
        CancellationToken cancellationToken = default)
    {
        var studentKey = userId.ToString();
        var sessionSeed = seed;
        var variant = PaperVariantBuilder.Build(snapshot, variantRule, studentKey, sessionSeed);

        // 难度标签名：给卷面一个可读的难度标签。
        var questionIds = snapshot.Items.Select(i => i.QuestionId).ToList();
        var loaded = await _questions.GetByIdsAsync(questionIds, cancellationToken);
        var difficultyIds = loaded.Select(q => q.DifficultyTagId).Distinct().ToList();
        var difficultyTags = difficultyIds.Count == 0
            ? []
            : await _tags.GetByIdsAsync(difficultyIds, cancellationToken);
        var difficultyNames = difficultyTags.ToDictionary(t => t.Id, t => t.Name);
        var questionDifficulty = loaded.ToDictionary(
            q => q.Id,
            q => difficultyNames.GetValueOrDefault(q.DifficultyTagId, string.Empty));

        var questions = variant.Items
            .Select(item =>
            {
                var source = snapshot.Items.First(s => s.QuestionId == item.QuestionId);
                var options = source.Options
                    .OrderBy(o => o.Key, StringComparer.Ordinal)
                    .ToDictionary(o => o.Key, o => o.Text);

                return new AttemptQuestionDto(
                    item.QuestionId,
                    source.QuestionCode,
                    QuestionTypes.ToStorage(item.QuestionType),
                    item.QuestionType.Label(),
                    source.Stem,
                    item.OptionOrder.Select(key => new PaperVariantOptionDto(key, options[key])).ToList(),
                    source.Score.Value,
                    questionDifficulty.GetValueOrDefault(source.QuestionId, string.Empty),
                    source.SectionTitle,
                    source.Attachments
                        .Select(a => new AttemptAttachmentDto(a.ObjectKey, a.FileName, a.ContentType, a.SizeBytes))
                        .ToList());
            })
            .ToList();

        return new AttemptPaperSurface(
            variant.VariantKey,
            $"{sessionSeed}:{studentKey}",
            questions);
    }
}
