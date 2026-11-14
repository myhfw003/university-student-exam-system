using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;

namespace Exam.Application.Authoring.Services;

/// <summary>候选题条目：抽题用的最小信息 + 给教师看的命中原因。</summary>
public sealed record BlueprintPoolEntry(QuestionCandidate Candidate, IReadOnlyList<string> MatchReason);

/// <summary>
/// 组卷候选池构建（应用层服务）。
/// <para>
/// 池子只放「可能入选」的题目：已发布、命中标签、难度在配额范围内。
/// 具体抽哪几道由领域里的抽题引擎决定，这里只负责把池子准备干净。
/// </para>
/// </summary>
public sealed class BlueprintPoolBuilder
{
    /// <summary>单次组卷最多扫描的题目数。</summary>
    public const int MaxPoolSize = 20000;

    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;

    public BlueprintPoolBuilder(IQuestionRepository questions, ITagRepository tags)
    {
        _questions = questions;
        _tags = tags;
    }

    public async Task<IReadOnlyList<BlueprintPoolEntry>> BuildAsync(
        BlueprintRules rules,
        CancellationToken cancellationToken = default)
    {
        // 展开标签：含子标签时，命中子标签也算命中。
        var selectorTagIds = new List<long>();
        foreach (var tagId in rules.TagSelector.TagIds)
        {
            var descendants = await _tags.GetDescendantIdsAsync(
                tagId,
                rules.TagSelector.IncludeDescendants,
                cancellationToken);
            selectorTagIds.AddRange(descendants);
        }

        selectorTagIds = selectorTagIds.Distinct().ToList();

        var criteria = new QuestionSearchCriteria
        {
            Status = QuestionStatus.Published,
            TagIds = rules.TagSelector.TagIds,
            IncludeDescendants = rules.TagSelector.IncludeDescendants,
            MatchMode = rules.TagSelector.MatchMode,
            DifficultyTagIds = rules.DifficultyQuota.Keys.ToList(),
            Skip = 0,
            Take = MaxPoolSize,
            SortBy = "code",
        };

        var questions = await _questions.SearchAsync(criteria, cancellationToken);

        // 难度标签的名称与等级：等级用于「按难度加权」分值。
        var difficultyIds = questions
            .Select(q => q.DifficultyTagId)
            .Distinct()
            .Concat(rules.DifficultyQuota.Keys)
            .Distinct()
            .ToList();
        var difficultyTags = await _tags.GetByIdsAsync(difficultyIds, cancellationToken);
        var difficultyById = difficultyTags.ToDictionary(t => t.Id);

        // 命中标签的名称，用于给教师解释「为什么抽了这道题」。
        var tagNames = new Dictionary<long, string>();
        if (selectorTagIds.Count > 0)
        {
            var selectorTags = await _tags.GetByIdsAsync(selectorTagIds, cancellationToken);
            foreach (var tag in selectorTags)
            {
                tagNames[tag.Id] = tag.Name;
            }
        }

        var entries = new List<BlueprintPoolEntry>();
        foreach (var question in questions)
        {
            var difficulty = difficultyById.TryGetValue(question.DifficultyTagId, out var tag) ? tag : null;
            var level = difficulty?.Level ?? 1;

            var reasons = new List<string>();
            foreach (var matched in question.TagIds.Where(tagNames.ContainsKey))
            {
                reasons.Add($"命中标签：{tagNames[matched]}");
            }

            if (difficulty is not null)
            {
                reasons.Add($"命中难度：{difficulty.Name}");
            }

            entries.Add(new BlueprintPoolEntry(
                new QuestionCandidate(
                    question.Id,
                    question.Code,
                    question.Type,
                    question.DifficultyTagId,
                    level,
                    difficulty?.Name ?? string.Empty),
                reasons));
        }

        return entries;
    }
}
