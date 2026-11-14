using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Learning.Queries;

/// <summary>
/// 错题本。
/// <para>
/// 可按标签（连标签子树一起）、题型、时间范围过滤。
/// </para>
/// </summary>
public sealed record ListMistakesQuery(
    long? TagId,
    string? QuestionType,
    DateTimeOffset? From,
    DateTimeOffset? To,
    bool IncludeResolved,
    int Page,
    int Size) : IAppQuery<MistakeListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class ListMistakesHandler : IRequestHandler<ListMistakesQuery, MistakeListResponse>
{
    private readonly IMistakeRepository _mistakes;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly ICurrentUser _currentUser;

    public ListMistakesHandler(
        IMistakeRepository mistakes,
        IQuestionRepository questions,
        ITagRepository tags,
        ICurrentUser currentUser)
    {
        _mistakes = mistakes;
        _questions = questions;
        _tags = tags;
        _currentUser = currentUser;
    }

    public async Task<MistakeListResponse> Handle(
        ListMistakesQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        // 按标签过滤时，标签子树里的题也算——父标签是子标签的集合。
        IReadOnlyCollection<long>? tagIds = null;
        if (request.TagId is { } tagId)
        {
            var descendants = await _tags.GetDescendantIdsAsync(tagId, includeSelf: true, cancellationToken);
            tagIds = descendants.Distinct().ToList();
        }

        QuestionType? questionType = null;
        if (!string.IsNullOrWhiteSpace(request.QuestionType))
        {
            questionType = QuestionTypes.FromStorage(request.QuestionType)
                ?? throw new BusinessRuleException("题型不合法。");
        }

        var criteria = new MistakeSearchCriteria
        {
            UserId = userId,
            TagIds = tagIds,
            QuestionType = questionType,
            From = request.From,
            To = request.To,
            IncludeResolved = request.IncludeResolved,
        };

        var mistakes = await _mistakes.SearchAsync(criteria, (page - 1) * size, size, cancellationToken);
        var total = await _mistakes.CountAsync(criteria, cancellationToken);

        var items = await MistakeDtoMapper.MapAsync(mistakes, _questions, _tags, cancellationToken);

        return new MistakeListResponse(items, total, page, size);
    }
}
