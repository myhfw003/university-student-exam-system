using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>监考初始快照。实时通道断线重连后也用它补齐数据。</summary>
public sealed record GetExamMonitoringQuery(long ExamSessionId)
    : IAppQuery<ExamStatusBatchDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ProctorMonitor];
}

public sealed class GetExamMonitoringHandler : IRequestHandler<GetExamMonitoringQuery, ExamStatusBatchDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly ExamMonitoringService _monitoring;

    public GetExamMonitoringHandler(IExamSessionRepository sessions, ExamMonitoringService monitoring)
    {
        _sessions = sessions;
        _monitoring = monitoring;
    }

    public async Task<ExamStatusBatchDto> Handle(
        GetExamMonitoringQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        return await _monitoring.BuildBatchAsync(session, cancellationToken);
    }
}
