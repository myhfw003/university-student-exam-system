using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Authoring.Commands;

/// <summary>新建试卷。</summary>
public sealed record CreatePaperCommand(
    string Kind,
    string Name,
    string? Batch,
    string? Description,
    decimal TargetTotalScore,
    int DurationMinutes,
    decimal? PassScore,
    string? Note,
    IReadOnlyList<long>? TagIds,
    string? OrderRule,
    string? VariantRule,
    string? AnswerPolicy,
    bool AllowRetake,
    bool RetakeKeepsBest,
    ExamRulesDtoInput? ExamRules,
    PracticeRulesDtoInput? PracticeRules) : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

/// <summary>考试卷规则输入。</summary>
public sealed record ExamRulesDtoInput(
    int? MaxFocusLoss,
    string? OnMaxFocusLoss,
    bool? RequireFullScreen,
    bool? BlockCopyPaste,
    bool? BlockContextMenu,
    bool? ShowWatermark,
    bool? EnableHeartbeatCheck,
    int? HeartbeatIntervalSeconds,
    int? HeartbeatTimeoutSeconds,
    int? MaxDisconnect,
    int? EarlyEntryMinutes);

/// <summary>练习卷规则输入。null 表示沿用默认值。</summary>
public sealed record PracticeRulesDtoInput(
    int? MaxAttempts,
    string? FeedbackTiming,
    bool? ReflowMistakes,
    int? SuggestedMinutes);

public sealed class CreatePaperCommandValidator : AbstractValidator<CreatePaperCommand>
{
    public CreatePaperCommandValidator()
    {
        RuleFor(x => x.Kind)
            .NotEmpty().WithMessage("请选择试卷形态。")
            .Must(k => PaperKinds.FromStorage(k) is not null).WithMessage("试卷形态取值不合法。");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写试卷名称。")
            .MaximumLength(200).WithMessage("试卷名称过长。");

        RuleFor(x => x.DurationMinutes)
            .InclusiveBetween(Paper.MinDurationMinutes, Paper.MaxDurationMinutes)
            .WithMessage($"考试时长必须在 {Paper.MinDurationMinutes} 到 {Paper.MaxDurationMinutes} 分钟之间。");

        RuleFor(x => x.TargetTotalScore)
            .InclusiveBetween(0m, Score.MaxPaperScore).WithMessage("目标总分超出范围。");

        RuleFor(x => x.TagIds)
            .Must(ids => (ids ?? []).Distinct().Count() <= Paper.MaxTagCount)
            .WithMessage($"每份试卷最多挂 {Paper.MaxTagCount} 个标签。");
    }
}

public sealed class CreatePaperHandler : IRequestHandler<CreatePaperCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreatePaperHandler(
        IPaperRepository papers,
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _tags = tags;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(CreatePaperCommand request, CancellationToken cancellationToken)
    {
        var kind = PaperKinds.FromStorage(request.Kind)
            ?? throw new BusinessRuleException("试卷形态取值不合法。");

        var now = _clock.UtcNow;
        var paper = Paper.CreateDraft(kind, request.Name, now, _currentUser.UserId);

        paper.UpdateMeta(
            request.Name,
            request.Batch,
            request.Description,
            Score.Paper(request.TargetTotalScore),
            request.DurationMinutes,
            request.PassScore is null ? null : Score.Paper(request.PassScore.Value),
            request.Note,
            now,
            _currentUser.UserId);

        if (request.OrderRule is not null)
        {
            paper.SetOrderRule(ParseOrderRule(request.OrderRule), now, _currentUser.UserId);
        }

        if (request.VariantRule is not null)
        {
            paper.SetVariantRule(ParseVariantRule(request.VariantRule), now, _currentUser.UserId);
        }

        if (request.AnswerPolicy is not null)
        {
            paper.SetAnswerPolicy(ParseAnswerPolicy(request.AnswerPolicy), now, _currentUser.UserId);
        }

        paper.SetRetake(request.AllowRetake, request.RetakeKeepsBest, now, _currentUser.UserId);

        if (kind == PaperKind.Exam && request.ExamRules is not null)
        {
            paper.SetExamRules(ToExamRules(request.ExamRules), now, _currentUser.UserId);
        }

        if (kind == PaperKind.Practice && request.PracticeRules is not null)
        {
            paper.SetPracticeRules(ToPracticeRules(request.PracticeRules), now, _currentUser.UserId);
        }

        foreach (var tagId in request.TagIds ?? [])
        {
            paper.AttachTag(tagId, now, _currentUser.UserId);
        }

        await _papers.AddAsync(paper, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "paper.create",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = paper.Name,
                ["kind"] = paper.Kind.ToStorage(),
            },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }

    internal static OrderRule ParseOrderRule(string value) =>
        OrderRules.FromStorage(value) ?? throw new BusinessRuleException("题序规则取值不合法。");

    internal static VariantRule ParseVariantRule(string value) =>
        VariantRules.FromStorage(value) ?? throw new BusinessRuleException("卷型规则取值不合法。");

    internal static AnswerPolicy ParseAnswerPolicy(string value) =>
        AnswerPolicies.FromStorage(value) ?? throw new BusinessRuleException("答案公布策略取值不合法。");

    internal static ExamRules ToExamRules(ExamRulesDtoInput input)
    {
        var defaults = ExamRules.Default;
        return new ExamRules
        {
            MaxFocusLoss = input.MaxFocusLoss ?? defaults.MaxFocusLoss,
            OnMaxFocusLoss = input.OnMaxFocusLoss ?? defaults.OnMaxFocusLoss,
            RequireFullScreen = input.RequireFullScreen ?? defaults.RequireFullScreen,
            BlockCopyPaste = input.BlockCopyPaste ?? defaults.BlockCopyPaste,
            BlockContextMenu = input.BlockContextMenu ?? defaults.BlockContextMenu,
            ShowWatermark = input.ShowWatermark ?? defaults.ShowWatermark,
            EnableHeartbeatCheck = input.EnableHeartbeatCheck ?? defaults.EnableHeartbeatCheck,
            HeartbeatIntervalSeconds = input.HeartbeatIntervalSeconds ?? defaults.HeartbeatIntervalSeconds,
            HeartbeatTimeoutSeconds = input.HeartbeatTimeoutSeconds ?? defaults.HeartbeatTimeoutSeconds,
            MaxDisconnect = input.MaxDisconnect ?? defaults.MaxDisconnect,
            EarlyEntryMinutes = input.EarlyEntryMinutes ?? defaults.EarlyEntryMinutes,
        };
    }

    internal static PracticeRules ToPracticeRules(PracticeRulesDtoInput input)
    {
        var defaults = PracticeRules.Default;
        return new PracticeRules
        {
            MaxAttempts = input.MaxAttempts ?? defaults.MaxAttempts,
            FeedbackTiming = input.FeedbackTiming ?? defaults.FeedbackTiming,
            ReflowMistakes = input.ReflowMistakes ?? defaults.ReflowMistakes,
            SuggestedMinutes = input.SuggestedMinutes ?? defaults.SuggestedMinutes,
        };
    }
}

/// <summary>修改试卷元信息。</summary>
public sealed record UpdatePaperCommand(
    long Id,
    string Name,
    string? Batch,
    string? Description,
    decimal TargetTotalScore,
    int DurationMinutes,
    decimal? PassScore,
    string? Note,
    IReadOnlyList<long>? TagIds,
    string? OrderRule,
    string? VariantRule,
    string? AnswerPolicy,
    bool AllowRetake,
    bool RetakeKeepsBest,
    ExamRulesDtoInput? ExamRules,
    PracticeRulesDtoInput? PracticeRules) : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class UpdatePaperHandler : IRequestHandler<UpdatePaperCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdatePaperHandler(
        IPaperRepository papers,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(UpdatePaperCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var now = _clock.UtcNow;

        paper.UpdateMeta(
            request.Name,
            request.Batch,
            request.Description,
            Score.Paper(request.TargetTotalScore),
            request.DurationMinutes,
            request.PassScore is null ? null : Score.Paper(request.PassScore.Value),
            request.Note,
            now,
            _currentUser.UserId);

        if (request.OrderRule is not null)
        {
            paper.SetOrderRule(CreatePaperHandler.ParseOrderRule(request.OrderRule), now, _currentUser.UserId);
        }

        if (request.VariantRule is not null)
        {
            paper.SetVariantRule(CreatePaperHandler.ParseVariantRule(request.VariantRule), now, _currentUser.UserId);
        }

        if (request.AnswerPolicy is not null)
        {
            paper.SetAnswerPolicy(CreatePaperHandler.ParseAnswerPolicy(request.AnswerPolicy), now, _currentUser.UserId);
        }

        paper.SetRetake(request.AllowRetake, request.RetakeKeepsBest, now, _currentUser.UserId);

        if (paper.Kind == PaperKind.Exam && request.ExamRules is not null)
        {
            paper.SetExamRules(CreatePaperHandler.ToExamRules(request.ExamRules), now, _currentUser.UserId);
        }

        if (paper.Kind == PaperKind.Practice && request.PracticeRules is not null)
        {
            paper.SetPracticeRules(CreatePaperHandler.ToPracticeRules(request.PracticeRules), now, _currentUser.UserId);
        }

        if (request.TagIds is not null)
        {
            var current = paper.TagIds.ToHashSet();
            var target = request.TagIds.Distinct().ToHashSet();

            foreach (var tagId in current.Except(target))
            {
                paper.DetachTag(tagId, now, _currentUser.UserId);
            }

            foreach (var tagId in target)
            {
                paper.AttachTag(tagId, now, _currentUser.UserId);
            }
        }

        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.update",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = paper.Name },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>删除试卷。只有草稿可删。</summary>
public sealed record DeletePaperCommand(long Id) : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class DeletePaperHandler : IRequestHandler<DeletePaperCommand, Unit>
{
    private readonly IPaperRepository _papers;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public DeletePaperHandler(
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

    public async Task<Unit> Handle(DeletePaperCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        if (paper.Status != PaperStatus.Draft)
        {
            throw new BusinessRuleException($"只有草稿状态的试卷才能删除，当前状态：{paper.Status.Label()}。");
        }

        paper.SoftDelete(_clock.UtcNow, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.delete",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = paper.Name },
            cancellationToken);

        return Unit.Value;
    }
}

/// <summary>试卷视图组装。</summary>
public static class PaperDtoFactory
{
    public static PaperSummaryDto ToSummary(Paper paper) => new(
        paper.Id,
        paper.Kind.ToStorage(),
        paper.Kind.Label(),
        paper.Name,
        paper.Batch,
        paper.Description,
        paper.Status.ToStorage(),
        paper.Status.Label(),
        paper.TargetTotalScore.Value,
        paper.TotalItemScore,
        paper.DurationMinutes,
        paper.PassScore?.Value,
        paper.Items.Count,
        paper.CreatedAt,
        paper.UpdatedAt);

    public static PaperDetailDto ToDetail(Paper paper) => new(
        ToSummary(paper),
        paper.Items
            .OrderBy(i => i.SortOrder)
            .Select(i => new PaperItemDto(i.Id, i.QuestionId, i.Score.Value, i.SortOrder, i.SectionId))
            .ToList(),
        paper.Sections
            .OrderBy(s => s.SortOrder)
            .Select(s => new PaperSectionDto(s.Id, s.Title, s.Instructions, s.SortOrder))
            .ToList(),
        paper.TagIds.OrderBy(id => id).ToList(),
        paper.OrderRule.ToStorage(),
        paper.VariantRule.ToStorage(),
        paper.AnswerPolicy.ToStorage(),
        paper.AllowRetake,
        paper.RetakeKeepsBest,
        paper.Note,
        paper.ExamRules is null ? null : ExamRulesDto.From(paper.ExamRules),
        paper.PracticeRules is null ? null : PracticeRulesDto.From(paper.PracticeRules),
        paper.PublishedSnapshotId);
}
