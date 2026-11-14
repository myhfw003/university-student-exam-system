using Exam.Application.Authoring.Commands;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>新建考试场次。</summary>
public sealed record CreateExamSessionCommand(
    long PaperId,
    string Name,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    int DurationMinutes,
    string ParticipantMode,
    IReadOnlyList<long>? ParticipantTagIds,
    IReadOnlyList<long>? ParticipantUserIds,
    string? VariantRule,
    ExamRulesDtoInput? Rules,
    string? Note) : IAppCommand<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class CreateExamSessionCommandValidator : AbstractValidator<CreateExamSessionCommand>
{
    public CreateExamSessionCommandValidator()
    {
        RuleFor(x => x.PaperId).GreaterThan(0).WithMessage("请选择试卷。");
        RuleFor(x => x.Name).NotEmpty().WithMessage("请填写场次名称。");
        RuleFor(x => x.DurationMinutes).GreaterThan(0).WithMessage("作答时长必须大于 0 分钟。");
        RuleFor(x => x.OpenAt).LessThan(x => x.CloseAt).WithMessage("开放时间必须早于关闭时间。");
        RuleFor(x => x.ParticipantMode).NotEmpty().WithMessage("请选择名单纳入方式。");
    }
}

public sealed class CreateExamSessionHandler : IRequestHandler<CreateExamSessionCommand, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreateExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _papers = papers;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionDetailDto> Handle(
        CreateExamSessionCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var mode = ParticipantModes.FromStorage(request.ParticipantMode)
            ?? throw new BusinessRuleException("名单纳入方式只能是 tags、direct 或 open。");

        var variantRule = request.VariantRule is null
            ? paper.VariantRule
            : VariantRules.FromStorage(request.VariantRule)
                ?? throw new BusinessRuleException("卷型规则取值不合法。");

        var now = _clock.UtcNow;
        var session = ExamSession.Create(
            paper.Id,
            request.Name,
            request.OpenAt,
            request.CloseAt,
            request.DurationMinutes,
            mode,
            now,
            _currentUser.UserId,
            request.ParticipantTagIds,
            request.ParticipantUserIds);

        session.Update(
            request.Name,
            request.OpenAt,
            request.CloseAt,
            request.DurationMinutes,
            mode,
            request.ParticipantTagIds,
            request.ParticipantUserIds,
            variantRule,
            request.Rules is null ? ExamRules.Default : CreatePaperHandler.ToExamRules(request.Rules),
            request.Note,
            now,
            _currentUser.UserId);

        await _sessions.AddAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "exam_session.create",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = session.Name,
                ["paperId"] = session.PaperId,
                ["participantMode"] = session.ParticipantMode.ToStorage(),
            },
            cancellationToken);

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}

/// <summary>修改场次配置。只有未发布的场次能改。</summary>
public sealed record UpdateExamSessionCommand(
    long Id,
    string Name,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    int DurationMinutes,
    string ParticipantMode,
    IReadOnlyList<long>? ParticipantTagIds,
    IReadOnlyList<long>? ParticipantUserIds,
    string? VariantRule,
    ExamRulesDtoInput? Rules,
    string? Note) : IAppCommand<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class UpdateExamSessionHandler : IRequestHandler<UpdateExamSessionCommand, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionDetailDto> Handle(
        UpdateExamSessionCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var mode = ParticipantModes.FromStorage(request.ParticipantMode)
            ?? throw new BusinessRuleException("名单纳入方式只能是 tags、direct 或 open。");

        var variantRule = request.VariantRule is null
            ? session.VariantRule
            : VariantRules.FromStorage(request.VariantRule)
                ?? throw new BusinessRuleException("卷型规则取值不合法。");

        var now = _clock.UtcNow;
        session.Update(
            request.Name,
            request.OpenAt,
            request.CloseAt,
            request.DurationMinutes,
            mode,
            request.ParticipantTagIds,
            request.ParticipantUserIds,
            variantRule,
            request.Rules is null ? session.Rules : CreatePaperHandler.ToExamRules(request.Rules),
            request.Note,
            now,
            _currentUser.UserId);

        _sessions.Update(session);

        await _audit.RecordAsync(
            "exam_session.update",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = session.Name,
                ["participantMode"] = session.ParticipantMode.ToStorage(),
            },
            cancellationToken);

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}

/// <summary>发布场次。绑定试卷快照，场次进入进行中。</summary>
public sealed record PublishExamSessionCommand(long Id)
    : IAppCommand<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamPublish];
}

public sealed class PublishExamSessionHandler : IRequestHandler<PublishExamSessionCommand, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public PublishExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionDetailDto> Handle(
        PublishExamSessionCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        if (paper.Status != PaperStatus.Published || paper.PublishedSnapshotId is null)
        {
            throw new BusinessRuleException("试卷尚未发布，请先发布试卷并生成快照。");
        }

        var now = _clock.UtcNow;
        session.Publish(paper.PublishedSnapshotId.Value, now, _currentUser.UserId);
        _sessions.Update(session);

        await _audit.RecordAsync(
            "exam_session.publish",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = session.Name,
                ["snapshotId"] = session.SnapshotId,
            },
            cancellationToken);

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}

/// <summary>关闭场次。</summary>
public sealed record CloseExamSessionCommand(long Id)
    : IAppCommand<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamPublish];
}

public sealed class CloseExamSessionHandler : IRequestHandler<CloseExamSessionCommand, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CloseExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionDetailDto> Handle(
        CloseExamSessionCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var now = _clock.UtcNow;
        session.Close(now, _currentUser.UserId);
        _sessions.Update(session);

        await _audit.RecordAsync(
            "exam_session.close",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = session.Name },
            cancellationToken);

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}

/// <summary>取消场次。已开始的会话拒绝继续作答，已提交的保留。</summary>
public sealed record CancelExamSessionCommand(long Id)
    : IAppCommand<ExamSessionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamPublish];
}

public sealed class CancelExamSessionHandler : IRequestHandler<CancelExamSessionCommand, ExamSessionDetailDto>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CancelExamSessionHandler(
        IExamSessionRepository sessions,
        IPaperRepository papers,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _papers = papers;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamSessionDetailDto> Handle(
        CancelExamSessionCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var now = _clock.UtcNow;
        session.Cancel(now, _currentUser.UserId);
        _sessions.Update(session);

        await _audit.RecordAsync(
            "exam_session.cancel",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = session.Name },
            cancellationToken);

        return ExamSessionDtoFactory.ToDetail(session, paper.Name);
    }
}
