using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>修改题目内容。已发布题目也允许改——已生成的试卷快照已冻结，不受影响。</summary>
public sealed record UpdateQuestionCommand(
    long Id,
    string? Code,
    string? Type,
    string Stem,
    decimal DefaultScore,
    IReadOnlyList<long> TagIds,
    long DifficultyTagId,
    IReadOnlyList<QuestionOptionInput>? Options,
    IReadOnlyList<QuestionKeypointInput>? Keypoints,
    IReadOnlyList<QuestionStepInput>? Steps,
    IReadOnlyList<AttachmentInput>? Attachments,
    string? Analysis,
    string? ReferenceAnswer) : IAppCommand<QuestionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionWrite];
}

public sealed class UpdateQuestionCommandValidator : AbstractValidator<UpdateQuestionCommand>
{
    public UpdateQuestionCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("题目 ID 不合法。");

        RuleFor(x => x.Code)
            .MaximumLength(64).WithMessage("题号长度不能超过 64 位。");

        RuleFor(x => x.Type)
            .Must(t => t is null || QuestionTypes.FromStorage(t) is not null || QuestionTypes.FromName(t) is not null)
            .WithMessage("题型取值不合法。");

        RuleFor(x => x.Stem)
            .NotEmpty().WithMessage("请填写题干。")
            .MaximumLength(Question.MaxStemLength).WithMessage("题干过长。");

        RuleFor(x => x.DefaultScore)
            .GreaterThan(0).WithMessage("题目分值必须大于 0。")
            .LessThanOrEqualTo(Score.MaxQuestionScore).WithMessage($"题目分值不能超过 {Score.MaxQuestionScore}。");

        RuleFor(x => x.DifficultyTagId).GreaterThan(0).WithMessage("请选择难度标签。");

        RuleFor(x => x.TagIds)
            .Must(ids => ids.Distinct().Count() <= Question.MaxTagCount)
            .WithMessage($"每道题最多挂 {Question.MaxTagCount} 个标签。");
    }
}

public sealed class UpdateQuestionHandler : IRequestHandler<UpdateQuestionCommand, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateQuestionHandler(
        IQuestionRepository questions,
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _questions = questions;
        _tags = tags;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionDetailDto> Handle(
        UpdateQuestionCommand request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        var now = _clock.UtcNow;

        if (!string.IsNullOrWhiteSpace(request.Code))
        {
            var code = request.Code.Trim();
            if (await _questions.CodeExistsAsync(code, question.Id, cancellationToken))
            {
                throw new DuplicateCodeException($"题号「{code}」已被占用。");
            }
        }

        var difficulty = await _tags.GetByIdAsync(request.DifficultyTagId, cancellationToken)
            ?? throw new QuestionValidationException($"标签不存在：{request.DifficultyTagId}。");
        if (difficulty.Group != TagGroup.Difficulty)
        {
            throw new QuestionValidationException("难度必须选择难度维度的标签。");
        }

        var tagIds = request.TagIds.Distinct().ToList();
        var tags = await _tags.GetByIdsAsync(tagIds, cancellationToken);
        var found = tags.Select(t => t.Id).ToHashSet();
        var missing = tagIds.Where(id => !found.Contains(id)).ToArray();
        if (missing.Length > 0)
        {
            throw new QuestionValidationException($"存在未知标签：{string.Join("、", missing)}。");
        }

        foreach (var tag in tags)
        {
            if (!tag.Group.AppliesToQuestions())
            {
                throw new QuestionValidationException($"「{tag.Name}」属于{tag.Group.Label()}维度，不能挂到题目上。");
            }
        }

        var previousTagIds = question.TagIds.ToHashSet();

        if (!string.IsNullOrWhiteSpace(request.Code))
        {
            question.ChangeCode(request.Code.Trim(), now, _currentUser.UserId);
        }

        if (!string.IsNullOrWhiteSpace(request.Type))
        {
            var type = QuestionTypes.FromStorage(request.Type) ?? QuestionTypes.FromName(request.Type)
                ?? throw new QuestionValidationException("题型取值不合法。");
            question.ChangeType(type, now, _currentUser.UserId);
        }

        question.UpdateContent(
            request.Stem,
            request.Analysis,
            request.ReferenceAnswer,
            Score.Question(request.DefaultScore),
            now,
            _currentUser.UserId);

        question.SetDifficulty(request.DifficultyTagId, now, _currentUser.UserId);

        if (request.Options is not null)
        {
            question.ClearOptions(now, _currentUser.UserId);
            foreach (var option in request.Options)
            {
                question.AddOption(
                    QuestionOption.Create(
                        option.Key?.Trim().ToUpperInvariant() ?? string.Empty,
                        option.Text,
                        option.IsCorrect,
                        0),
                    now,
                    _currentUser.UserId);
            }
        }

        if (request.Keypoints is not null)
        {
            question.ClearKeypoints(now, _currentUser.UserId);
            foreach (var keypoint in request.Keypoints)
            {
                question.AddKeypoint(
                    QuestionKeypoint.Create(keypoint.Text, keypoint.Keywords ?? [], 0),
                    now,
                    _currentUser.UserId);
            }
        }

        if (request.Steps is not null)
        {
            question.ClearSteps(now, _currentUser.UserId);
            foreach (var step in request.Steps)
            {
                question.AddStep(
                    QuestionStep.Create(
                        step.Code?.Trim() ?? string.Empty,
                        step.Prompt,
                        step.ReferenceAnswer,
                        step.Keywords ?? [],
                        Score.Question(step.Score),
                        0),
                    now,
                    _currentUser.UserId);
            }
        }

        if (request.Attachments is not null)
        {
            foreach (var existing in question.Attachments.ToList())
            {
                question.RemoveAttachment(existing.Id, now, _currentUser.UserId);
            }

            foreach (var attachment in request.Attachments)
            {
                question.AttachAttachment(
                    QuestionAttachment.Create(
                        attachment.ObjectKey,
                        attachment.FileName,
                        attachment.ContentType,
                        attachment.SizeBytes,
                        question.Attachments.Count,
                        now),
                    now,
                    _currentUser.UserId);
            }
        }

        var currentTagIds = question.TagIds.ToHashSet();
        foreach (var tagId in previousTagIds.Except(currentTagIds).ToList())
        {
            question.DetachTag(tagId, now, _currentUser.UserId);
        }

        foreach (var tag in tags)
        {
            question.AttachTag(tag.Id, now, _currentUser.UserId);
        }

        _questions.Update(question);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 标签引用计数跟随挂载关系同步。
        foreach (var tagId in previousTagIds.Except(currentTagIds))
        {
            var removed = await _tags.GetByIdAsync(tagId, cancellationToken);
            if (removed is not null)
            {
                removed.DecrementUsage();
                _tags.Update(removed);
            }
        }

        foreach (var tag in tags.Where(t => !previousTagIds.Contains(t.Id)))
        {
            tag.IncrementUsage();
            _tags.Update(tag);
        }

        await _audit.RecordAsync(
            "question.update",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["code"] = question.Code,
                ["status"] = question.Status.ToStorage(),
            },
            cancellationToken);

        return QuestionDtoFactory.ToDetail(question);
    }
}

/// <summary>发布题目。</summary>
public sealed record PublishQuestionCommand(long Id) : IAppCommand<QuestionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionPublish];
}

public sealed class PublishQuestionHandler : IRequestHandler<PublishQuestionCommand, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public PublishQuestionHandler(
        IQuestionRepository questions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _questions = questions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionDetailDto> Handle(
        PublishQuestionCommand request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        var now = _clock.UtcNow;
        question.Publish(now, _currentUser.UserId);
        _questions.Update(question);

        await _audit.RecordAsync(
            "question.publish",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?> { ["code"] = question.Code },
            cancellationToken);

        return QuestionDtoFactory.ToDetail(question);
    }
}

/// <summary>停用题目。</summary>
public sealed record DisableQuestionCommand(long Id) : IAppCommand<QuestionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionPublish];
}

public sealed class DisableQuestionHandler : IRequestHandler<DisableQuestionCommand, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public DisableQuestionHandler(
        IQuestionRepository questions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _questions = questions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionDetailDto> Handle(
        DisableQuestionCommand request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        question.Disable(_clock.UtcNow, _currentUser.UserId);
        _questions.Update(question);

        await _audit.RecordAsync(
            "question.disable",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?> { ["code"] = question.Code },
            cancellationToken);

        return QuestionDtoFactory.ToDetail(question);
    }
}

/// <summary>恢复已停用的题目。</summary>
public sealed record RestoreQuestionCommand(long Id) : IAppCommand<QuestionDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionPublish];
}

public sealed class RestoreQuestionHandler : IRequestHandler<RestoreQuestionCommand, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public RestoreQuestionHandler(
        IQuestionRepository questions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _questions = questions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionDetailDto> Handle(
        RestoreQuestionCommand request,
        CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        question.Restore(_clock.UtcNow, _currentUser.UserId);
        _questions.Update(question);

        await _audit.RecordAsync(
            "question.restore",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?> { ["code"] = question.Code },
            cancellationToken);

        return QuestionDtoFactory.ToDetail(question);
    }
}

/// <summary>删除题目。只有草稿可删。</summary>
public sealed record DeleteQuestionCommand(long Id) : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionWrite];
}

public sealed class DeleteQuestionHandler : IRequestHandler<DeleteQuestionCommand, Unit>
{
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public DeleteQuestionHandler(
        IQuestionRepository questions,
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _questions = questions;
        _tags = tags;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(DeleteQuestionCommand request, CancellationToken cancellationToken)
    {
        var question = await _questions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        question.EnsureDeletable();

        var now = _clock.UtcNow;
        var tagIds = question.TagIds.ToList();

        question.SoftDelete(now, _currentUser.UserId);
        _questions.Update(question);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        foreach (var tagId in tagIds)
        {
            var tag = await _tags.GetByIdAsync(tagId, cancellationToken);
            if (tag is not null)
            {
                tag.DecrementUsage();
                _tags.Update(tag);
            }
        }

        await _audit.RecordAsync(
            "question.delete",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?> { ["code"] = question.Code },
            cancellationToken);

        return Unit.Value;
    }
}
