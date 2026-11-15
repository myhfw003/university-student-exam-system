using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Identity;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Learning.Queries;

/// <summary>管理端练习列表。</summary>
public sealed record ListPracticeAssignmentsQuery(
    string? Keyword,
    string? Status,
    int Page,
    int Size) : IAppQuery<PracticeAssignmentListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PracticeRead];
}

public sealed class ListPracticeAssignmentsHandler
    : IRequestHandler<ListPracticeAssignmentsQuery, PracticeAssignmentListResponse>
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly PracticeAssignmentService _service;

    public ListPracticeAssignmentsHandler(
        IPracticeAssignmentRepository assignments,
        PracticeAssignmentService service)
    {
        _assignments = assignments;
        _service = service;
    }

    public async Task<PracticeAssignmentListResponse> Handle(
        ListPracticeAssignmentsQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 100);

        PracticeAssignmentStatus? status = null;
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            status = PracticeAssignmentStatuses.FromStorage(request.Status.Trim().ToLowerInvariant())
                ?? throw new BusinessRuleException("练习状态取值不合法。");
        }

        var all = await _assignments.ListAsync(status, request.Keyword, cancellationToken);
        var pageItems = all.Skip((page - 1) * size).Take(size).ToList();

        return new PracticeAssignmentListResponse(
            await _service.BuildDtosAsync(pageItems, cancellationToken),
            all.Count,
            page,
            size);
    }
}
