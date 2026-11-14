using Exam.Application.Authoring.Contracts;
using Exam.Application.Authoring.Queries;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Authoring.Commands;

/// <summary>
/// 发布试卷。
/// <para>校验不通过就拒绝；警告项可以填写理由后覆盖。</para>
/// </summary>
public sealed record PublishPaperCommand(long Id, string? WarningOverrideReason)
    : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperPublish];
}

public sealed class PublishPaperHandler : IRequestHandler<PublishPaperCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IQuestionRepository _questions;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public PublishPaperHandler(
        IPaperRepository papers,
        IQuestionRepository questions,
        IPaperSnapshotRepository snapshots,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _questions = questions;
        _snapshots = snapshots;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(
        PublishPaperCommand request,
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

        var items = new PaperPublicationValidator().Validate(paper, statuses, subjective, rosterConfigured: true);

        var blockingFailures = items
            .Where(i => !i.Passed && i.Severity == ValidationSeverity.Blocking)
            .ToList();

        if (blockingFailures.Count > 0)
        {
            throw new PaperPublicationException(
                "发布校验未通过，请按提示修正后重试。",
                items);
        }

        var warningFailures = items.Where(i => !i.Passed && i.Severity == ValidationSeverity.Warning).ToList();
        if (warningFailures.Count > 0 && string.IsNullOrWhiteSpace(request.WarningOverrideReason))
        {
            throw new PaperPublicationException(
                "发布校验有警告项未确认，请填写覆盖理由后重试。",
                items);
        }

        // 发布即冻结内容：生成一个新的快照版本，之后改题不会影响已发布的卷面。
        var now = _clock.UtcNow;
        var latest = await _snapshots.GetLatestAsync(paper.Id, cancellationToken);
        var version = (latest?.SnapshotVersion ?? 0) + 1;
        var snapshot = PaperSnapshot.Create(paper, questions, version, now, _currentUser.UserId);
        await _snapshots.AddAsync(snapshot, cancellationToken);

        // 先落库拿到快照主键，试卷才能绑定已发布快照。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        paper.Publish(snapshot.Id, now, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.publish",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = paper.Name,
                ["snapshotId"] = snapshot.Id,
                ["snapshotVersion"] = snapshot.SnapshotVersion,
                ["contentHash"] = snapshot.ContentHash,
                ["warningOverrideReason"] = request.WarningOverrideReason,
            },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>撤回发布。回到草稿，保留快照。</summary>
public sealed record UnpublishPaperCommand(long Id) : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperPublish];
}

public sealed class UnpublishPaperHandler : IRequestHandler<UnpublishPaperCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UnpublishPaperHandler(
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(
        UnpublishPaperCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        paper.Unpublish(_clock.UtcNow, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.unpublish",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = paper.Name },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>归档 / 下架。</summary>
public sealed record ArchivePaperCommand(long Id) : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperPublish];
}

public sealed class ArchivePaperHandler : IRequestHandler<ArchivePaperCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ArchivePaperHandler(
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(
        ArchivePaperCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        paper.Archive(_clock.UtcNow, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.archive",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = paper.Name },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}
