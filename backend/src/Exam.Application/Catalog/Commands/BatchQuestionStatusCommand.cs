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

/// <summary>批量变更题目状态。逐条返回成功与失败原因，不因个别失败中断整批。</summary>
public sealed record BatchQuestionStatusCommand(
    IReadOnlyList<long> QuestionIds,
    string TargetStatus) : IAppCommand<BatchStatusResult>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.QuestionPublish];
}

public sealed class BatchQuestionStatusCommandValidator : AbstractValidator<BatchQuestionStatusCommand>
{
    public BatchQuestionStatusCommandValidator()
    {
        RuleFor(x => x.QuestionIds)
            .NotEmpty().WithMessage("请至少选择一道题目。")
            .Must(ids => ids.Count <= 200).WithMessage("单次最多处理 200 道题。");

        RuleFor(x => x.TargetStatus)
            .NotEmpty().WithMessage("请指定目标状态。")
            .Must(s => QuestionStatuses.FromStorage(s) is not null)
            .WithMessage("目标状态只能是 draft / published / disabled。");
    }
}

public sealed class BatchQuestionStatusHandler : IRequestHandler<BatchQuestionStatusCommand, BatchStatusResult>
{
    private readonly IQuestionRepository _questions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public BatchQuestionStatusHandler(
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

    public async Task<BatchStatusResult> Handle(
        BatchQuestionStatusCommand request,
        CancellationToken cancellationToken)
    {
        var target = QuestionStatuses.FromStorage(request.TargetStatus)
            ?? throw new BusinessRuleException("目标状态取值不合法。");

        var now = _clock.UtcNow;
        var items = new List<BatchStatusItem>(request.QuestionIds.Count);
        var succeeded = 0;

        foreach (var questionId in request.QuestionIds.Distinct())
        {
            var question = await _questions.GetByIdAsync(questionId, cancellationToken);
            if (question is null)
            {
                items.Add(new BatchStatusItem(questionId, false, "题目不存在。"));
                continue;
            }

            try
            {
                switch (target)
                {
                    case QuestionStatus.Published:
                        question.Publish(now, _currentUser.UserId);
                        break;
                    case QuestionStatus.Disabled:
                        question.Disable(now, _currentUser.UserId);
                        break;
                    case QuestionStatus.Draft:
                        question.EnsureDeletable();
                        break;
                }

                _questions.Update(question);
                items.Add(new BatchStatusItem(questionId, true, null));
                succeeded++;
            }
            catch (DomainException ex)
            {
                items.Add(new BatchStatusItem(questionId, false, ex.Message));
            }
        }

        await _audit.RecordAsync(
            "question.batch-status",
            "question",
            null,
            new Dictionary<string, object?>
            {
                ["targetStatus"] = target.ToStorage(),
                ["total"] = request.QuestionIds.Count,
                ["succeeded"] = succeeded,
            },
            cancellationToken);

        return new BatchStatusResult(request.QuestionIds.Count, succeeded, items);
    }
}
