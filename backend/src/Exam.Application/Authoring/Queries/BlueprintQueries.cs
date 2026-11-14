using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Authoring.Queries;

/// <summary>取回试卷的组卷方案。</summary>
public sealed record GetBlueprintQuery(long PaperId) : IAppQuery<BlueprintDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class GetBlueprintHandler : IRequestHandler<GetBlueprintQuery, BlueprintDto>
{
    private readonly IBlueprintRepository _blueprints;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;

    public GetBlueprintHandler(
        IBlueprintRepository blueprints,
        IQuestionRepository questions,
        ITagRepository tags)
    {
        _blueprints = blueprints;
        _questions = questions;
        _tags = tags;
    }

    public async Task<BlueprintDto> Handle(GetBlueprintQuery request, CancellationToken cancellationToken)
    {
        var blueprint = await _blueprints.GetByPaperAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("组卷方案不存在。");

        var infos = await BlueprintInfoBuilder.BuildAsync(blueprint, _questions, _tags, cancellationToken);
        var items = BlueprintDtoFactory.ToPlanItems(blueprint, infos);

        return BlueprintDtoFactory.ToDto(blueprint, items);
    }
}

/// <summary>方案与试卷当前题位的差异。</summary>
public sealed record GetBlueprintDiffQuery(long PaperId) : IAppQuery<BlueprintDiffDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class GetBlueprintDiffHandler : IRequestHandler<GetBlueprintDiffQuery, BlueprintDiffDto>
{
    private readonly IPaperRepository _papers;
    private readonly IBlueprintRepository _blueprints;

    public GetBlueprintDiffHandler(IPaperRepository papers, IBlueprintRepository blueprints)
    {
        _papers = papers;
        _blueprints = blueprints;
    }

    public async Task<BlueprintDiffDto> Handle(GetBlueprintDiffQuery request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var blueprint = await _blueprints.GetByPaperAsync(paper.Id, cancellationToken)
            ?? throw new NotFoundException("组卷方案不存在。");

        var current = paper.Items
            .Select(i => (i.QuestionId, i.Score.Value))
            .ToList();

        return BlueprintDtoFactory.ToDto(blueprint.Diff(current));
    }
}

/// <summary>方案条目所需的题目信息（题号、题型、难度、命中原因）。</summary>
public static class BlueprintInfoBuilder
{
    public static async Task<IReadOnlyDictionary<long, BlueprintItemInfo>> BuildAsync(
        Blueprint blueprint,
        IQuestionRepository questions,
        ITagRepository tags,
        CancellationToken cancellationToken)
    {
        var questionIds = blueprint.Plan.Items.Select(i => i.QuestionId).ToList();
        if (questionIds.Count == 0)
        {
            return new Dictionary<long, BlueprintItemInfo>();
        }

        var loaded = await questions.GetByIdsAsync(questionIds, cancellationToken);
        var difficultyIds = loaded.Select(q => q.DifficultyTagId).Distinct().ToList();
        var difficultyTags = difficultyIds.Count == 0
            ? []
            : await tags.GetByIdsAsync(difficultyIds, cancellationToken);
        var difficultyById = difficultyTags.ToDictionary(t => t.Id);

        var selectorIds = blueprint.Rules.TagSelector.TagIds;
        var selectorTagIds = new List<long>();
        foreach (var tagId in selectorIds)
        {
            selectorTagIds.AddRange(await tags.GetDescendantIdsAsync(
                tagId,
                blueprint.Rules.TagSelector.IncludeDescendants,
                cancellationToken));
        }

        selectorTagIds = selectorTagIds.Distinct().ToList();
        var tagNames = new Dictionary<long, string>();
        if (selectorTagIds.Count > 0)
        {
            var selectorTags = await tags.GetByIdsAsync(selectorTagIds, cancellationToken);
            foreach (var tag in selectorTags)
            {
                tagNames[tag.Id] = tag.Name;
            }
        }

        var infos = new Dictionary<long, BlueprintItemInfo>();
        foreach (var question in loaded)
        {
            var difficulty = difficultyById.TryGetValue(question.DifficultyTagId, out var tag) ? tag : null;
            var reasons = question.TagIds
                .Where(tagNames.ContainsKey)
                .Select(id => $"命中标签：{tagNames[id]}")
                .ToList();

            if (difficulty is not null)
            {
                reasons.Add($"命中难度：{difficulty.Name}");
            }

            infos[question.Id] = new BlueprintItemInfo(
                question.Code,
                QuestionTypes.ToStorage(question.Type),
                question.Type.Label(),
                question.DifficultyTagId,
                difficulty?.Name ?? string.Empty,
                reasons);
        }

        return infos;
    }
}
