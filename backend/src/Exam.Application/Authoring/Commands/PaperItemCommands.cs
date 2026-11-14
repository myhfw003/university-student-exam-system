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

/// <summary>追加题位。</summary>
public sealed record AddPaperItemCommand(long PaperId, long QuestionId, decimal Score, int? SortOrder)
    : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class AddPaperItemHandler : IRequestHandler<AddPaperItemCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IQuestionRepository _questions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AddPaperItemHandler(
        IPaperRepository papers,
        IQuestionRepository questions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _questions = questions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(AddPaperItemCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var question = await _questions.GetByIdAsync(request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("题目不存在。");

        var now = _clock.UtcNow;
        var sortOrder = request.SortOrder ?? paper.Items.Count;

        paper.AddItem(question, Score.Question(request.Score), sortOrder, now, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.add-item",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["questionId"] = request.QuestionId,
                ["score"] = request.Score,
            },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>调整题位分值与顺序。</summary>
public sealed record UpdatePaperItemCommand(long PaperId, long ItemId, decimal? Score, int? SortOrder)
    : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class UpdatePaperItemHandler : IRequestHandler<UpdatePaperItemCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdatePaperItemHandler(
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

    public async Task<PaperDetailDto> Handle(UpdatePaperItemCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var item = paper.Items.FirstOrDefault(i => i.Id == request.ItemId)
            ?? throw new NotFoundException("题位不存在。");

        var now = _clock.UtcNow;

        if (request.Score is not null)
        {
            paper.SetItemScore(item.QuestionId, Score.Question(request.Score.Value), now, _currentUser.UserId);
        }

        if (request.SortOrder is not null)
        {
            paper.SetItemSortOrder(item.QuestionId, request.SortOrder.Value, now, _currentUser.UserId);
        }

        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.update-item",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["itemId"] = request.ItemId },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>移除题位。</summary>
public sealed record RemovePaperItemCommand(long PaperId, long ItemId) : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

public sealed class RemovePaperItemHandler : IRequestHandler<RemovePaperItemCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public RemovePaperItemHandler(
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

    public async Task<PaperDetailDto> Handle(RemovePaperItemCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var item = paper.Items.FirstOrDefault(i => i.Id == request.ItemId)
            ?? throw new NotFoundException("题位不存在。");

        paper.RemoveItem(item.QuestionId, _clock.UtcNow, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.remove-item",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["itemId"] = request.ItemId },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}

/// <summary>整体替换题位集合。</summary>
public sealed record ReplacePaperItemsCommand(long PaperId, IReadOnlyList<PaperItemInput> Items)
    : IAppCommand<PaperDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.PaperWrite];
}

/// <summary>题位输入。</summary>
public sealed record PaperItemInput(long QuestionId, decimal Score);

public sealed class ReplacePaperItemsHandler : IRequestHandler<ReplacePaperItemsCommand, PaperDetailDto>
{
    private readonly IPaperRepository _papers;
    private readonly IQuestionRepository _questions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ReplacePaperItemsHandler(
        IPaperRepository papers,
        IQuestionRepository questions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _questions = questions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<PaperDetailDto> Handle(ReplacePaperItemsCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var questionIds = request.Items.Select(i => i.QuestionId).Distinct().ToList();
        var questions = await _questions.GetByIdsAsync(questionIds, cancellationToken);
        var byId = questions.ToDictionary(q => q.Id);

        var missing = questionIds.Where(id => !byId.ContainsKey(id)).ToArray();
        if (missing.Length > 0)
        {
            throw new BusinessRuleException($"存在未知题目：{string.Join("、", missing)}。");
        }

        var items = request.Items
            .Select(i => (Question: byId[i.QuestionId], Score: Score.Question(i.Score)))
            .ToList();

        paper.ReplaceItems(items, _clock.UtcNow, _currentUser.UserId);
        _papers.Update(paper);

        await _audit.RecordAsync(
            "paper.replace-items",
            "paper",
            paper.Id.ToString(),
            new Dictionary<string, object?> { ["count"] = request.Items.Count },
            cancellationToken);

        return PaperDtoFactory.ToDetail(paper);
    }
}
