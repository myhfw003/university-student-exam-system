using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Identity;
using Exam.Domain.Learning;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Learning.Commands;

/// <summary>新建练习开放单。</summary>
public sealed record CreatePracticeAssignmentCommand(
    long PaperId,
    string Title,
    IReadOnlyList<long>? ScopeTagIds,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt) : IAppCommand<PracticeAssignmentDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PracticeWrite];
}

public sealed class CreatePracticeAssignmentValidator : AbstractValidator<CreatePracticeAssignmentCommand>
{
    public CreatePracticeAssignmentValidator()
    {
        RuleFor(x => x.PaperId).GreaterThan(0).WithMessage("请选择练习试卷。");
        RuleFor(x => x.Title).NotEmpty().WithMessage("请填写练习标题。");
        RuleFor(x => x.CloseAt)
            .GreaterThan(x => x.OpenAt)
            .WithMessage("关闭时间必须晚于开放时间。")
            .When(x => x.OpenAt is not null && x.CloseAt is not null);
    }
}

/// <summary>改练习设置：标题、开放范围与开放期。</summary>
public sealed record UpdatePracticeAssignmentCommand(
    long Id,
    string Title,
    IReadOnlyList<long>? ScopeTagIds,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt) : IAppCommand<PracticeAssignmentDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PracticeWrite];
}

public sealed class UpdatePracticeAssignmentValidator : AbstractValidator<UpdatePracticeAssignmentCommand>
{
    public UpdatePracticeAssignmentValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("练习不存在。");
        RuleFor(x => x.Title).NotEmpty().WithMessage("请填写练习标题。");
        RuleFor(x => x.CloseAt)
            .GreaterThan(x => x.OpenAt)
            .WithMessage("关闭时间必须晚于开放时间。")
            .When(x => x.OpenAt is not null && x.CloseAt is not null);
    }
}

/// <summary>上架。</summary>
public sealed record PublishPracticeAssignmentCommand(long Id) : IAppCommand<PracticeAssignmentDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PracticeWrite];
}

/// <summary>下架。下架之后学生就看不到这个练习了。</summary>
public sealed record ArchivePracticeAssignmentCommand(long Id) : IAppCommand<PracticeAssignmentDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PracticeWrite];
}

public sealed class CreatePracticeAssignmentHandler
    : IRequestHandler<CreatePracticeAssignmentCommand, PracticeAssignmentDto>
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly IPaperRepository _papers;
    private readonly PracticeAssignmentService _service;
    private readonly IAuditRecorder _audit;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreatePracticeAssignmentHandler(
        IPracticeAssignmentRepository assignments,
        IPaperRepository papers,
        PracticeAssignmentService service,
        IAuditRecorder audit,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _assignments = assignments;
        _papers = papers;
        _service = service;
        _audit = audit;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PracticeAssignmentDto> Handle(
        CreatePracticeAssignmentCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("练习试卷不存在。");

        if (paper.Kind != PaperKind.Practice)
        {
            throw new BusinessRuleException("练习只能挂练习类型的试卷。");
        }

        await _service.EnsureOrganizationScopeAsync(request.ScopeTagIds, cancellationToken);

        var now = _clock.UtcNow;
        var assignment = PracticeAssignment.Create(
            request.PaperId,
            request.Title,
            request.ScopeTagIds,
            request.OpenAt,
            request.CloseAt,
            now,
            _currentUser.UserId);

        await _assignments.AddAsync(assignment, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "practice_assignment.create",
            "practice_assignment",
            assignment.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["paperId"] = assignment.PaperId,
                ["title"] = assignment.Title,
                ["scopeTagIds"] = assignment.ScopeTagIds,
            },
            cancellationToken);

        return await _service.BuildDtoAsync(assignment, cancellationToken);
    }
}

public sealed class UpdatePracticeAssignmentHandler
    : IRequestHandler<UpdatePracticeAssignmentCommand, PracticeAssignmentDto>
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly PracticeAssignmentService _service;
    private readonly IAuditRecorder _audit;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdatePracticeAssignmentHandler(
        IPracticeAssignmentRepository assignments,
        PracticeAssignmentService service,
        IAuditRecorder audit,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _assignments = assignments;
        _service = service;
        _audit = audit;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PracticeAssignmentDto> Handle(
        UpdatePracticeAssignmentCommand request,
        CancellationToken cancellationToken)
    {
        var assignment = await _assignments.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("练习不存在。");

        await _service.EnsureOrganizationScopeAsync(request.ScopeTagIds, cancellationToken);

        assignment.UpdateSettings(
            request.Title,
            request.ScopeTagIds,
            request.OpenAt,
            request.CloseAt,
            _clock.UtcNow,
            _currentUser.UserId);

        _assignments.Update(assignment);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "practice_assignment.update",
            "practice_assignment",
            assignment.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["title"] = assignment.Title,
                ["scopeTagIds"] = assignment.ScopeTagIds,
            },
            cancellationToken);

        return await _service.BuildDtoAsync(assignment, cancellationToken);
    }
}

public sealed class PublishPracticeAssignmentHandler
    : IRequestHandler<PublishPracticeAssignmentCommand, PracticeAssignmentDto>
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly PracticeAssignmentService _service;
    private readonly IAuditRecorder _audit;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public PublishPracticeAssignmentHandler(
        IPracticeAssignmentRepository assignments,
        PracticeAssignmentService service,
        IAuditRecorder audit,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _assignments = assignments;
        _service = service;
        _audit = audit;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PracticeAssignmentDto> Handle(
        PublishPracticeAssignmentCommand request,
        CancellationToken cancellationToken)
    {
        var assignment = await _assignments.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("练习不存在。");

        assignment.Publish(_clock.UtcNow, _currentUser.UserId);
        _assignments.Update(assignment);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "practice_assignment.publish",
            "practice_assignment",
            assignment.Id.ToString(),
            null,
            cancellationToken);

        return await _service.BuildDtoAsync(assignment, cancellationToken);
    }
}

public sealed class ArchivePracticeAssignmentHandler
    : IRequestHandler<ArchivePracticeAssignmentCommand, PracticeAssignmentDto>
{
    private readonly IPracticeAssignmentRepository _assignments;
    private readonly PracticeAssignmentService _service;
    private readonly IAuditRecorder _audit;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ArchivePracticeAssignmentHandler(
        IPracticeAssignmentRepository assignments,
        PracticeAssignmentService service,
        IAuditRecorder audit,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _assignments = assignments;
        _service = service;
        _audit = audit;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PracticeAssignmentDto> Handle(
        ArchivePracticeAssignmentCommand request,
        CancellationToken cancellationToken)
    {
        var assignment = await _assignments.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("练习不存在。");

        assignment.Archive(_clock.UtcNow, _currentUser.UserId);
        _assignments.Update(assignment);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "practice_assignment.archive",
            "practice_assignment",
            assignment.Id.ToString(),
            null,
            cancellationToken);

        return await _service.BuildDtoAsync(assignment, cancellationToken);
    }
}
