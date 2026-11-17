using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>分页查询题目。所有过滤都在服务端完成。</summary>
public sealed record ListQuestionsQuery(
    long? BankId,
    string? Type,
    string? Status,
    IReadOnlyList<long>? TagIds,
    bool IncludeDescendants,
    string? MatchMode,
    IReadOnlyList<long>? DifficultyTagIds,
    string? Keyword,
    int Page,
    int Size,
    string? SortBy,
    bool SortDescending) : IAppQuery<QuestionListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionRead];
}

public sealed class ListQuestionsHandler : IRequestHandler<ListQuestionsQuery, QuestionListResponse>
{
    private readonly IQuestionRepository _questions;

    public ListQuestionsHandler(IQuestionRepository questions) => _questions = questions;

    public async Task<QuestionListResponse> Handle(
        ListQuestionsQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        var criteria = new QuestionSearchCriteria
        {
            BankId = request.BankId,
            Type = ParseType(request.Type),
            Status = ParseStatus(request.Status),
            TagIds = request.TagIds ?? [],
            IncludeDescendants = request.IncludeDescendants,
            MatchMode = ParseMatchMode(request.MatchMode),
            DifficultyTagIds = request.DifficultyTagIds ?? [],
            Keyword = request.Keyword,
            Skip = (page - 1) * size,
            Take = size,
            SortBy = request.SortBy,
            SortDescending = request.SortDescending,
        };

        var total = await _questions.CountAsync(criteria, cancellationToken);
        var questions = await _questions.SearchAsync(criteria, cancellationToken);

        var items = questions.Select(QuestionDtoFactory.ToSummary).ToList();
        return new QuestionListResponse(items, total, page, size);
    }

    private static QuestionType? ParseType(string? type)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            return null;
        }

        return QuestionTypes.FromStorage(type) ?? QuestionTypes.FromName(type)
            ?? throw new BusinessRuleException("题型取值不合法。");
    }

    private static QuestionStatus? ParseStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return null;
        }

        return QuestionStatuses.FromStorage(status)
            ?? throw new BusinessRuleException("题目状态取值不合法。");
    }

    private static TagMatchMode ParseMatchMode(string? matchMode)
    {
        if (string.IsNullOrWhiteSpace(matchMode))
        {
            return TagMatchMode.Any;
        }

        return matchMode.ToLowerInvariant() switch
        {
            "any" => TagMatchMode.Any,
            "all" => TagMatchMode.All,
            _ => throw new BusinessRuleException("命中模式只能是 any 或 all。"),
        };
    }
}

/// <summary>取回单个题目详情。</summary>
public sealed record GetQuestionQuery(long Id) : IAppQuery<QuestionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionRead];
}

public sealed class GetQuestionHandler : IRequestHandler<GetQuestionQuery, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly ICurrentUser _currentUser;

    public GetQuestionHandler(IQuestionRepository questions, ICurrentUser currentUser)
    {
        _questions = questions;
        _currentUser = currentUser;
    }

    public async Task<QuestionDetailDto> Handle(GetQuestionQuery request, CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        // 只有能出题或阅卷的人可以看到答案与解析；学生直接读题目时脱敏。
        var includeSensitive =
            _currentUser.HasPermission(PermissionCatalog.QuestionWrite)
            || _currentUser.HasPermission(PermissionCatalog.QuestionPublish)
            || _currentUser.HasPermission(PermissionCatalog.ReviewGrade)
            || _currentUser.HasPermission(PermissionCatalog.AttemptReadAll);

        return QuestionDtoFactory.ToDetail(question, includeSensitive);
    }
}

/// <summary>可用筛选项：题型、状态、难度与标签的取值集合。</summary>
public sealed record QuestionFilterOptionsDto(
    IReadOnlyList<string> Types,
    IReadOnlyList<string> Statuses,
    IReadOnlyList<long> DifficultyTagIds,
    IReadOnlyList<long> TagIds);

public sealed record GetQuestionFiltersQuery : IAppQuery<QuestionFilterOptionsDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionRead];
}

public sealed class GetQuestionFiltersHandler : IRequestHandler<GetQuestionFiltersQuery, QuestionFilterOptionsDto>
{
    private readonly ITagRepository _tags;

    public GetQuestionFiltersHandler(ITagRepository tags) => _tags = tags;

    public async Task<QuestionFilterOptionsDto> Handle(
        GetQuestionFiltersQuery request,
        CancellationToken cancellationToken)
    {
        var tags = await _tags.ListAsync(null, cancellationToken);

        return new QuestionFilterOptionsDto(
            QuestionTypes.All.Select(t => t.ToStorage()).ToList(),
            new[] { "draft", "published", "disabled" },
            tags.Where(t => t.Group == TagGroup.Difficulty).Select(t => t.Id).ToList(),
            tags.Where(t => t.Group != TagGroup.Difficulty && t.Group != TagGroup.Organization)
                .Select(t => t.Id)
                .ToList());
    }
}
