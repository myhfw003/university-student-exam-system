using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Authoring.Queries;

/// <summary>列出某份试卷的全部快照版本（新版本在前）。</summary>
public sealed record ListPaperSnapshotsQuery(long PaperId) : IAppQuery<PaperSnapshotListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class ListPaperSnapshotsHandler : IRequestHandler<ListPaperSnapshotsQuery, PaperSnapshotListResponse>
{
    private readonly IPaperSnapshotRepository _snapshots;

    public ListPaperSnapshotsHandler(IPaperSnapshotRepository snapshots) => _snapshots = snapshots;

    public async Task<PaperSnapshotListResponse> Handle(
        ListPaperSnapshotsQuery request,
        CancellationToken cancellationToken)
    {
        var snapshots = await _snapshots.ListByPaperAsync(request.PaperId, cancellationToken);

        return new PaperSnapshotListResponse(
            request.PaperId,
            snapshots.Select(PaperSnapshotDtoFactory.ToSummary).ToList(),
            snapshots.Count);
    }
}

/// <summary>
/// 取回某个快照版本。<paramref name="Version"/> 为空时取最新版本。
/// </summary>
public sealed record GetPaperSnapshotQuery(long PaperId, int? Version) : IAppQuery<PaperSnapshotDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperRead];
}

public sealed class GetPaperSnapshotHandler : IRequestHandler<GetPaperSnapshotQuery, PaperSnapshotDetailDto>
{
    private readonly IPaperSnapshotRepository _snapshots;

    public GetPaperSnapshotHandler(IPaperSnapshotRepository snapshots) => _snapshots = snapshots;

    public async Task<PaperSnapshotDetailDto> Handle(
        GetPaperSnapshotQuery request,
        CancellationToken cancellationToken)
    {
        var snapshot = request.Version is null
            ? await _snapshots.GetLatestAsync(request.PaperId, cancellationToken)
            : (await _snapshots.ListByPaperAsync(request.PaperId, cancellationToken))
                .FirstOrDefault(s => s.SnapshotVersion == request.Version);

        if (snapshot is null)
        {
            throw new NotFoundException("试卷快照不存在。");
        }

        return PaperSnapshotDtoFactory.ToDetail(snapshot);
    }
}
