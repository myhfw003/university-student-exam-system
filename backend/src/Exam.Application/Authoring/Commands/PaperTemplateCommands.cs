using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Authoring.Commands;

/// <summary>由试卷另存为模板。</summary>
public sealed record CreatePaperTemplateCommand(long PaperId, string? Name)
    : IAppCommand<PaperTemplateDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class CreatePaperTemplateHandler : IRequestHandler<CreatePaperTemplateCommand, PaperTemplateDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IPaperTemplateRepository _templates;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreatePaperTemplateHandler(
        IPaperRepository papers,
        IPaperTemplateRepository templates,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _templates = templates;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperTemplateDetailDto> Handle(
        CreatePaperTemplateCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var now = _clock.UtcNow;
        var template = PaperTemplate.CreateFrom(paper, request.Name, now, _currentUser.UserId);
        await _templates.AddAsync(template, cancellationToken);

        // 先落库拿到模板主键，响应里要带上模板 ID。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "paper_template.create",
            "paper_template",
            paper.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["name"] = template.Name,
                ["sourcePaperId"] = paper.Id,
                ["itemCount"] = template.Items.Count,
            },
            cancellationToken);

        return PaperTemplateDtoFactory.ToDetail(template);
    }
}

/// <summary>把模板套用到目标试卷。已停用的题目会被跳过并报告。</summary>
public sealed record ApplyPaperTemplateCommand(long TemplateId, long PaperId)
    : IAppCommand<TemplateApplyResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class ApplyPaperTemplateHandler : IRequestHandler<ApplyPaperTemplateCommand, TemplateApplyResponse>
{
    private readonly IPaperRepository _papers;
    private readonly IPaperTemplateRepository _templates;
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ApplyPaperTemplateHandler(
        IPaperRepository papers,
        IPaperTemplateRepository templates,
        IQuestionRepository questions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _templates = templates;
        _questions = questions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<TemplateApplyResponse> Handle(
        ApplyPaperTemplateCommand request,
        CancellationToken cancellationToken)
    {
        var template = await _templates.GetByIdAsync(request.TemplateId, cancellationToken)
            ?? throw new NotFoundException("卷型模板不存在。");

        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var questionIds = template.Items.Select(i => i.QuestionId).Distinct().ToList();
        var questions = await _questions.GetByIdsAsync(questionIds, cancellationToken);

        var pool = questions
            .Select(q => new TemplateQuestionInfo(
                q,
                q.Status == QuestionStatus.Published,
                q.Status == QuestionStatus.Published
                    ? null
                    : q.Status == QuestionStatus.Disabled ? "题目已停用" : "题目未发布"))
            .ToList();

        var now = _clock.UtcNow;
        var result = template.ApplyTo(paper, pool, now, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper_template.apply",
            "paper_template",
            template.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["paperId"] = paper.Id,
                ["appliedCount"] = result.AppliedCount,
                ["skippedCount"] = result.SkippedCount,
            },
            cancellationToken);

        return new TemplateApplyResponse(
            template.Id,
            paper.Id,
            result.AppliedCount,
            result.SkippedCount,
            result.TotalScore,
            result.Skipped.Select(s => new TemplateSkippedItemDto(s.QuestionId, s.Code, s.Reason)).ToList(),
            PaperDtoFactory.ToDetail(paper));
    }
}
