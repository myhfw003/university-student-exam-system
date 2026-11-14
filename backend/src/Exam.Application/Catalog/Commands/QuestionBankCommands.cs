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

/// <summary>新建题库。</summary>
public sealed record CreateQuestionBankCommand(string Name, string? Description)
    : IAppCommand<QuestionBankDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankWrite];
}

public sealed class CreateQuestionBankCommandValidator : AbstractValidator<CreateQuestionBankCommand>
{
    public CreateQuestionBankCommandValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写题库名称。")
            .MaximumLength(QuestionBank.MaxNameLength).WithMessage($"题库名称长度不能超过 {QuestionBank.MaxNameLength} 位。");
    }
}

public sealed class CreateQuestionBankHandler : IRequestHandler<CreateQuestionBankCommand, QuestionBankDetailDto>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreateQuestionBankHandler(
        IQuestionBankRepository banks,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _banks = banks;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionBankDetailDto> Handle(
        CreateQuestionBankCommand request,
        CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        if (await _banks.GetByNameAsync(name, cancellationToken) is not null)
        {
            throw new DuplicateCodeException($"题库「{name}」已存在。");
        }

        var bank = QuestionBank.Create(name, request.Description, _clock.UtcNow, _currentUser.UserId);
        await _banks.AddAsync(bank, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _audit.RecordAsync(
            "question-bank.create",
            "question-bank",
            bank.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = bank.Name },
            cancellationToken);

        return QuestionBankDtoFactory.ToDetail(bank, []);
    }
}

/// <summary>修改题库名称与说明。</summary>
public sealed record UpdateQuestionBankCommand(long Id, string Name, string? Description)
    : IAppCommand<QuestionBankDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankWrite];
}

public sealed class UpdateQuestionBankHandler : IRequestHandler<UpdateQuestionBankCommand, QuestionBankDetailDto>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateQuestionBankHandler(
        IQuestionBankRepository banks,
        IQuestionRepository questions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _banks = banks;
        _questions = questions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionBankDetailDto> Handle(
        UpdateQuestionBankCommand request,
        CancellationToken cancellationToken)
    {
        var bank = await _banks.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题库不存在。");

        var name = request.Name.Trim();
        var sameName = await _banks.GetByNameAsync(name, cancellationToken);
        if (sameName is not null && sameName.Id != bank.Id)
        {
            throw new DuplicateCodeException($"题库「{name}」已存在。");
        }

        bank.Rename(name, _clock.UtcNow, _currentUser.UserId);
        bank.ChangeDescription(request.Description, _clock.UtcNow, _currentUser.UserId);
        _banks.Update(bank);

        var questionList = await _questions.GetByIdsAsync(bank.QuestionIds.ToList(), cancellationToken);

        await _audit.RecordAsync(
            "question-bank.update",
            "question-bank",
            bank.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = bank.Name },
            cancellationToken);

        return QuestionBankDtoFactory.ToDetail(bank, questionList);
    }
}

/// <summary>批量把题目加入题库。</summary>
public sealed record AddQuestionBankItemsCommand(long BankId, IReadOnlyList<long> QuestionIds)
    : IAppCommand<QuestionBankDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankWrite];
}

public sealed class AddQuestionBankItemsHandler : IRequestHandler<AddQuestionBankItemsCommand, QuestionBankDetailDto>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IQuestionRepository _questions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AddQuestionBankItemsHandler(
        IQuestionBankRepository banks,
        IQuestionRepository questions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _banks = banks;
        _questions = questions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionBankDetailDto> Handle(
        AddQuestionBankItemsCommand request,
        CancellationToken cancellationToken)
    {
        var bank = await _banks.GetByIdAsync(request.BankId, cancellationToken)
            ?? throw new NotFoundException("题库不存在。");

        var now = _clock.UtcNow;
        foreach (var questionId in request.QuestionIds.Distinct())
        {
            bank.AddQuestion(questionId, now, _currentUser.UserId);
        }

        _banks.Update(bank);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var questionList = await _questions.GetByIdsAsync(bank.QuestionIds.ToList(), cancellationToken);

        await _audit.RecordAsync(
            "question-bank.add-items",
            "question-bank",
            bank.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["questionIds"] = request.QuestionIds.Distinct().ToArray(),
            },
            cancellationToken);

        return QuestionBankDtoFactory.ToDetail(bank, questionList);
    }
}

/// <summary>批量把题目移出题库。移出题库不删除题目本身。</summary>
public sealed record RemoveQuestionBankItemsCommand(long BankId, IReadOnlyList<long> QuestionIds)
    : IAppCommand<QuestionBankDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankWrite];
}

public sealed class RemoveQuestionBankItemsHandler : IRequestHandler<RemoveQuestionBankItemsCommand, QuestionBankDetailDto>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public RemoveQuestionBankItemsHandler(
        IQuestionBankRepository banks,
        IQuestionRepository questions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _banks = banks;
        _questions = questions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<QuestionBankDetailDto> Handle(
        RemoveQuestionBankItemsCommand request,
        CancellationToken cancellationToken)
    {
        var bank = await _banks.GetByIdAsync(request.BankId, cancellationToken)
            ?? throw new NotFoundException("题库不存在。");

        var now = _clock.UtcNow;
        foreach (var questionId in request.QuestionIds.Distinct())
        {
            bank.RemoveQuestion(questionId, now, _currentUser.UserId);
        }

        _banks.Update(bank);

        var questionList = await _questions.GetByIdsAsync(bank.QuestionIds.ToList(), cancellationToken);

        await _audit.RecordAsync(
            "question-bank.remove-items",
            "question-bank",
            bank.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["questionIds"] = request.QuestionIds.Distinct().ToArray(),
            },
            cancellationToken);

        return QuestionBankDtoFactory.ToDetail(bank, questionList);
    }
}

/// <summary>删除题库。</summary>
public sealed record DeleteQuestionBankCommand(long Id) : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankWrite];
}

public sealed class DeleteQuestionBankHandler : IRequestHandler<DeleteQuestionBankCommand, Unit>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public DeleteQuestionBankHandler(
        IQuestionBankRepository banks,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _banks = banks;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(DeleteQuestionBankCommand request, CancellationToken cancellationToken)
    {
        var bank = await _banks.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题库不存在。");

        bank.SoftDelete(_clock.UtcNow, _currentUser.UserId);
        _banks.Update(bank);

        await _audit.RecordAsync(
            "question-bank.delete",
            "question-bank",
            bank.Id.ToString(),
            new Dictionary<string, object?> { ["name"] = bank.Name },
            cancellationToken);

        return Unit.Value;
    }
}

/// <summary>题库视图组装。</summary>
public static class QuestionBankDtoFactory
{
    public static QuestionBankSummaryDto ToSummary(QuestionBank bank) =>
        new(bank.Id, bank.Name, bank.Description, bank.Items.Count);

    public static QuestionBankDetailDto ToDetail(
        QuestionBank bank,
        IReadOnlyList<Question> questions)
    {
        var ordered = questions.OrderBy(q => q.Code, StringComparer.Ordinal).ToList();

        var objective = ordered.Where(q => q.Type.IsObjective()).ToList();
        var subjective = ordered.Where(q => !q.Type.IsObjective()).ToList();

        var statistics = new QuestionBankStatistics(
            ordered.Count,
            ordered.Count(q => q.Status == QuestionStatus.Draft),
            ordered.Count(q => q.Status == QuestionStatus.Published),
            ordered.Count(q => q.Status == QuestionStatus.Disabled),
            objective.Count,
            Score.Sum(objective.Select(q => q.DefaultScore)),
            subjective.Count,
            Score.Sum(subjective.Select(q => q.DefaultScore)));

        return new QuestionBankDetailDto(
            ToSummary(bank),
            ordered.Select(QuestionDtoFactory.ToSummary).ToList(),
            statistics);
    }
}
