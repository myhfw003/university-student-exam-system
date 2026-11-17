using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Authoring.Queries;

/// <summary>
/// 预览某位考生实际拿到的卷面。
/// <para>卷面来自已发布的快照，与考生进场时拿到的一致。</para>
/// </summary>
public sealed record PreviewPaperVariantQuery(long PaperId, string StudentKey, string SessionSeed)
    : IAppQuery<PaperVariantDto>, IAuthorizableRequest
{
    // 卷面预览是出题工具：考生卷面只能从自己的作答里取。
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class PreviewPaperVariantHandler : IRequestHandler<PreviewPaperVariantQuery, PaperVariantDto>
{
    private readonly IPaperRepository _papers;
    private readonly IPaperSnapshotRepository _snapshots;

    public PreviewPaperVariantHandler(IPaperRepository papers, IPaperSnapshotRepository snapshots)
    {
        _papers = papers;
        _snapshots = snapshots;
    }

    public async Task<PaperVariantDto> Handle(
        PreviewPaperVariantQuery request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var snapshot = await _snapshots.GetLatestAsync(paper.Id, cancellationToken)
            ?? throw new NotFoundException("试卷尚未发布，没有可预览的卷面。");

        var studentKey = string.IsNullOrWhiteSpace(request.StudentKey) ? "preview" : request.StudentKey.Trim();
        var sessionSeed = string.IsNullOrWhiteSpace(request.SessionSeed) ? paper.Id.ToString() : request.SessionSeed.Trim();

        var variant = PaperVariantBuilder.Build(snapshot, paper.VariantRule, studentKey, sessionSeed);

        return PaperVariantDtoFactory.ToDto(snapshot, variant);
    }
}
