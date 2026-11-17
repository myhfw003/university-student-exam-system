using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>分页查询考试场次。</summary>
public sealed record ListExamSessionsQuery(string? Status, string? Keyword, int Page, int Size)
    : IAppQuery<ExamSessionListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamRead];
}

public sealed class ListExamSessionsHandler : IRequestHandler<ListExamSessionsQuery, ExamSessionListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly ExamAccessScope _scope;

    public ListExamSessionsHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _papers = papers;
        _scope = scope;
    }

    public async Task<ExamSessionListResponse> Handle(
        ListExamSessionsQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        ExamSessionStatus? status = null;
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            status = ExamSessionStatuses.FromStorage(request.Status)
                ?? throw new BusinessRuleException("场次状态取值不合法。");
        }

        // 对象级范围：考生只看得到自己参加的与全员开放的场次，
        // 教职人员只看得到自己负责的场次。范围之外一律不列。
        var scope = await _scope.ResolveAsync(cancellationToken);

        IReadOnlyList<ExamSession> sessions;
        int total;

        if (scope.Tier == AccessScopeTier.Manager)
        {
            total = await _sessions.CountAsync(status, request.Keyword, cancellationToken);
            sessions = await _sessions.ListAsync(status, request.Keyword, cancellationToken);
        }
        else
        {
            var visible = await _sessions.GetByIdsAsync(scope.SessionIds.ToList(), cancellationToken);
            sessions = visible
                .Where(s => status is null || s.Status == status.Value)
                .Where(s => string.IsNullOrWhiteSpace(request.Keyword)
                    || s.Name.Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase))
                .OrderBy(s => s.OpenAt)
                .ThenBy(s => s.Id)
                .ToList();
            total = sessions.Count;
        }

        var pageItems = sessions.Skip((page - 1) * size).Take(size).ToList();

        var papers = await _papers.GetByIdsAsync(pageItems.Select(s => s.PaperId).Distinct().ToList(), cancellationToken);
        var paperNames = papers.ToDictionary(p => p.Id, p => p.Name);

        return new ExamSessionListResponse(
            pageItems.Select(s => ExamSessionDtoFactory.ToSummary(s, paperNames.GetValueOrDefault(s.PaperId, string.Empty))).ToList(),
            total,
            page,
            size);
    }
}

/// <summary>取回考试场次详情。</summary>
public sealed record GetExamSessionQuery(long Id) : IAppQuery<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamRead];
}

public sealed class GetExamSessionHandler : IRequestHandler<GetExamSessionQuery, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly ExamAccessScope _scope;

    public GetExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _papers = papers;
        _scope = scope;
    }

    public async Task<ExamSessionDetailDto> Handle(GetExamSessionQuery request, CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 范围之外不返回：考生看不到别人的场次，教职人员看不到不负责的场次。
        await _scope.EnsureSessionVisibleAsync(session.Id, cancellationToken);

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}
