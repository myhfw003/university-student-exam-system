using Exam.Application.Authoring.Commands;
using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Authoring.Queries;

/// <summary>分页查询试卷。</summary>
public sealed record ListPapersQuery(string? Kind, string? Status, string? Keyword, int Page, int Size)
    : IAppQuery<PaperListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class ListPapersHandler : IRequestHandler<ListPapersQuery, PaperListResponse>
{
    private readonly IPaperRepository _papers;
    private readonly ExamAccessScope _scope;

    public ListPapersHandler(IPaperRepository papers, ExamAccessScope scope)
    {
        _papers = papers;
        _scope = scope;
    }

    public async Task<PaperListResponse> Handle(ListPapersQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        PaperKind? kind = null;
        if (!string.IsNullOrWhiteSpace(request.Kind))
        {
            kind = PaperKinds.FromStorage(request.Kind)
                ?? throw new BusinessRuleException("试卷形态取值不合法。");
        }

        PaperStatus? status = null;
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            status = PaperStatuses.FromStorage(request.Status)
                ?? throw new BusinessRuleException("试卷状态取值不合法。");
        }

        // 对象级范围：考生只看得到自己场次与练习挂着的试卷，
        // 教职人员只看得到自己出的卷子。全局管理者看得到全部。
        var scope = await _scope.ResolveAsync(cancellationToken);

        IReadOnlyList<Paper> papers;
        int total;

        if (scope.Tier == AccessScopeTier.Manager)
        {
            total = await _papers.CountAsync(kind, status, request.Keyword, cancellationToken);
            papers = await _papers.ListAsync(kind, status, request.Keyword, (page - 1) * size, size, cancellationToken);
        }
        else
        {
            var visible = await _papers.GetByIdsAsync(scope.PaperIds.ToList(), cancellationToken);
            var filtered = visible
                .Where(p => kind is null || p.Kind == kind.Value)
                .Where(p => status is null || p.Status == status.Value)
                .Where(p => string.IsNullOrWhiteSpace(request.Keyword)
                    || p.Name.Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase)
                    || (p.Batch?.Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase) ?? false))
                .OrderByDescending(p => p.UpdatedAt ?? p.CreatedAt)
                .ThenByDescending(p => p.Id)
                .ToList();

            total = filtered.Count;
            papers = filtered.Skip((page - 1) * size).Take(size).ToList();
        }

        return new PaperListResponse(
            papers.Select(PaperDtoFactory.ToSummary).ToList(),
            total,
            page,
            size);
    }
}

/// <summary>取回试卷详情。</summary>
public sealed record GetPaperQuery(long Id) : IAppQuery<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class GetPaperHandler : IRequestHandler<GetPaperQuery, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly ExamAccessScope _scope;

    public GetPaperHandler(IPaperRepository papers, ExamAccessScope scope)
    {
        _papers = papers;
        _scope = scope;
    }

    public async Task<PaperDetailDto> Handle(GetPaperQuery request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        await _scope.EnsurePaperVisibleAsync(paper.Id, cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>发布校验。不改变试卷状态。</summary>
public sealed record ValidatePaperQuery(long Id) : IAppQuery<PaperValidationResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class ValidatePaperHandler : IRequestHandler<ValidatePaperQuery, PaperValidationResponse>
{
    private readonly IPaperRepository _papers;
    private readonly IQuestionRepository _questions;

    public ValidatePaperHandler(IPaperRepository papers, IQuestionRepository questions)
    {
        _papers = papers;
        _questions = questions;
    }

    public async Task<PaperValidationResponse> Handle(
        ValidatePaperQuery request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var questionIds = paper.Items.Select(i => i.QuestionId).Distinct().ToList();
        var questions = await _questions.GetByIdsAsync(questionIds, cancellationToken);

        var statuses = questions.ToDictionary(q => q.Id, q => q.Status.ToStorage());
        var subjective = questions
            .Where(q => !q.Type.IsObjective())
            .Select(q => q.Id)
            .ToHashSet();

        var items = new PaperPublicationValidator().Validate(
            paper,
            statuses,
            subjective,
            rosterConfigured: true);

        return PaperValidationResponseFactory.Build(items);
    }
}

/// <summary>发布校验结果组装。</summary>
public static class PaperValidationResponseFactory
{
    public static PaperValidationResponse Build(IReadOnlyList<ValidationItem> items)
    {
        var dtos = items
            .Select(i => new PaperValidationItemDto(
                i.Key,
                i.Label,
                i.Passed,
                i.Severity == ValidationSeverity.Blocking ? "blocking" : "warning",
                i.Detail,
                i.Targets))
            .ToList();

        var hasBlockingFailure = items.Any(i => !i.Passed && i.Severity == ValidationSeverity.Blocking);

        return new PaperValidationResponse(dtos, !hasBlockingFailure, hasBlockingFailure);
    }
}
