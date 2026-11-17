using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>新建题目。新建一律是草稿。</summary>
public sealed record CreateQuestionCommand(
    string Code,
    string Type,
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

public sealed class CreateQuestionCommandValidator : AbstractValidator<CreateQuestionCommand>
{
    public CreateQuestionCommandValidator()
    {
        RuleFor(x => x.Code)
            .NotEmpty().WithMessage("请填写题号。")
            .MaximumLength(64).WithMessage("题号长度不能超过 64 位。");

        RuleFor(x => x.Type)
            .NotEmpty().WithMessage("请选择题型。")
            .Must(t => QuestionTypes.FromStorage(t) is not null || QuestionTypes.FromName(t) is not null)
            .WithMessage("题型取值不合法。");

        RuleFor(x => x.Stem)
            .NotEmpty().WithMessage("请填写题干。")
            .MaximumLength(Question.MaxStemLength).WithMessage("题干过长。");

        RuleFor(x => x.DefaultScore)
            .GreaterThan(0).WithMessage("题目分值必须大于 0。")
            .LessThanOrEqualTo(Score.MaxQuestionScore).WithMessage($"题目分值不能超过 {Score.MaxQuestionScore}。");

        RuleFor(x => x.DifficultyTagId)
            .GreaterThan(0).WithMessage("请选择难度标签。");

        RuleFor(x => x.TagIds)
            .Must(ids => ids.Distinct().Count() <= Question.MaxTagCount)
            .WithMessage($"每道题最多挂 {Question.MaxTagCount} 个标签。");
    }
}

public sealed class CreateQuestionHandler : IRequestHandler<CreateQuestionCommand, QuestionDetailDto>
{
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreateQuestionHandler(
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
        CreateQuestionCommand request,
        CancellationToken cancellationToken)
    {
        var type = QuestionTypes.FromStorage(request.Type) ?? QuestionTypes.FromName(request.Type)
            ?? throw new QuestionValidationException("题型取值不合法。");

        var code = request.Code.Trim();
        if (await _questions.CodeExistsAsync(code, null, cancellationToken))
        {
            throw new DuplicateCodeException($"题号「{code}」已被占用。");
        }

        var now = _clock.UtcNow;
        var question = Question.CreateDraft(
            code,
            type,
            request.Stem,
            Score.Question(request.DefaultScore),
            request.DifficultyTagId,
            now,
            _currentUser.UserId);

        var difficulty = await LoadTagAsync(request.DifficultyTagId, cancellationToken);
        if (difficulty.Group != TagGroup.Difficulty)
        {
            throw new QuestionValidationException("难度必须选择难度维度的标签。");
        }

        var tags = await LoadTagsAsync(request.TagIds, cancellationToken);
        foreach (var tag in tags)
        {
            if (!tag.Group.AppliesToQuestions())
            {
                throw new QuestionValidationException($"「{tag.Name}」属于{tag.Group.Label()}维度，不能挂到题目上。");
            }
        }

        question.UpdateContent(
            request.Stem,
            request.Analysis,
            request.ReferenceAnswer,
            Score.Question(request.DefaultScore),
            now,
            _currentUser.UserId);

        ApplyStructure(question, request, now);

        foreach (var tag in tags)
        {
            question.AttachTag(tag.Id, now, _currentUser.UserId);
        }

        foreach (var attachment in request.Attachments ?? [])
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

        await _questions.AddAsync(question, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        foreach (var tag in tags)
        {
            tag.IncrementUsage();
            _tags.Update(tag);
        }

        await _audit.RecordAsync(
            "question.create",
            "question",
            question.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["code"] = question.Code,
                ["type"] = question.Type.ToStorage(),
                ["difficultyTagId"] = question.DifficultyTagId,
            },
            cancellationToken);

        return QuestionDtoFactory.ToDetail(question);
    }

    private void ApplyStructure(Question question, CreateQuestionCommand request, DateTimeOffset now)
    {
        foreach (var option in request.Options ?? [])
        {
            question.AddOption(
                QuestionOption.Create(option.Key?.Trim().ToUpperInvariant() ?? string.Empty, option.Text, option.IsCorrect, 0),
                now);
        }

        foreach (var keypoint in request.Keypoints ?? [])
        {
            question.AddKeypoint(
                QuestionKeypoint.Create(keypoint.Text, keypoint.Keywords ?? [], 0),
                now);
        }

        foreach (var step in request.Steps ?? [])
        {
            question.AddStep(
                QuestionStep.Create(
                    step.Code?.Trim() ?? string.Empty,
                    step.Prompt,
                    step.ReferenceAnswer,
                    step.Keywords ?? [],
                    Score.Question(step.Score),
                    0),
                now);
        }
    }

    private async Task<Tag> LoadTagAsync(long tagId, CancellationToken cancellationToken) =>
        await _tags.GetByIdAsync(tagId, cancellationToken)
        ?? throw new QuestionValidationException($"标签不存在：{tagId}。");

    private async Task<IReadOnlyList<Tag>> LoadTagsAsync(
        IReadOnlyList<long> tagIds,
        CancellationToken cancellationToken)
    {
        if (tagIds.Count == 0)
        {
            return [];
        }

        var tags = await _tags.GetByIdsAsync(tagIds.Distinct().ToList(), cancellationToken);
        var found = tags.Select(t => t.Id).ToHashSet();
        var missing = tagIds.Where(id => !found.Contains(id)).ToArray();
        if (missing.Length > 0)
        {
            throw new QuestionValidationException($"存在未知标签：{string.Join("、", missing)}。");
        }

        return tags;
    }
}

/// <summary>题目视图组装。详情与列表共用。</summary>
public static class QuestionDtoFactory
{
    public static QuestionSummaryDto ToSummary(Question question) => new(
        question.Id,
        question.Code,
        question.Type.ToStorage(),
        question.Type.Label(),
        question.Stem,
        question.DefaultScore.Value,
        question.Status.ToStorage(),
        question.Status.Label(),
        question.Source.ToStorage(),
        question.DifficultyTagId,
        question.TagIds.OrderBy(id => id).ToList(),
        question.CreatedAt,
        question.UpdatedAt);

    /// <summary>
    /// 题目详情。
    /// <para>
    /// <paramref name="includeSensitive"/> 为 false 时脱敏：不返回正确选项标记、
    /// 评分要点、参考答案与解析。学生/社会人士直接读题目时走这一支——
    /// 考试进行中绝不通过题目接口泄露答案。
    /// </para>
    /// </summary>
    public static QuestionDetailDto ToDetail(Question question, bool includeSensitive = true) => new(
        ToSummary(question),
        question.Options
            .OrderBy(o => o.SortOrder)
            .ThenBy(o => o.Key, StringComparer.Ordinal)
            .Select(o => new QuestionOptionDto(o.Key, o.Text, includeSensitive && o.IsCorrect))
            .ToList(),
        includeSensitive
            ? question.Keypoints
                .OrderBy(k => k.SortOrder)
                .Select(k => new QuestionKeypointDto(k.Text, k.Keywords))
                .ToList()
            : [],
        question.Steps
            .OrderBy(s => s.SortOrder)
            .Select(s => new QuestionStepDto(
                s.Code,
                s.Prompt,
                includeSensitive ? s.ReferenceAnswer : null,
                includeSensitive ? s.Keywords : [],
                s.Score.Value))
            .ToList(),
        question.Attachments
            .OrderBy(a => a.SortOrder)
            .Select(a => new QuestionAttachmentDto(a.Id, a.FileName, a.ContentType, a.SizeBytes))
            .ToList(),
        includeSensitive ? question.Analysis : null,
        includeSensitive ? question.ReferenceAnswer : null);
}
