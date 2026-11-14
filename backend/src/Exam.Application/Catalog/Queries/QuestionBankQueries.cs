using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Catalog.Queries;

/// <summary>列出全部题库。</summary>
public sealed record ListQuestionBanksQuery : IAppQuery<IReadOnlyList<QuestionBankSummaryDto>>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankRead];
}

public sealed class ListQuestionBanksHandler : IRequestHandler<ListQuestionBanksQuery, IReadOnlyList<QuestionBankSummaryDto>>
{
    private readonly IQuestionBankRepository _banks;

    public ListQuestionBanksHandler(IQuestionBankRepository banks) => _banks = banks;

    public async Task<IReadOnlyList<QuestionBankSummaryDto>> Handle(
        ListQuestionBanksQuery request,
        CancellationToken cancellationToken)
    {
        var banks = await _banks.ListAsync(cancellationToken);
        return banks.Select(QuestionBankDtoFactory.ToSummary).ToList();
    }
}

/// <summary>取回题库详情：题目清单与三态统计。</summary>
public sealed record GetQuestionBankQuery(long Id) : IAppQuery<QuestionBankDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BankRead];
}

public sealed class GetQuestionBankHandler : IRequestHandler<GetQuestionBankQuery, QuestionBankDetailDto>
{
    private readonly IQuestionBankRepository _banks;
    private readonly IQuestionRepository _questions;

    public GetQuestionBankHandler(IQuestionBankRepository banks, IQuestionRepository questions)
    {
        _banks = banks;
        _questions = questions;
    }

    public async Task<QuestionBankDetailDto> Handle(
        GetQuestionBankQuery request,
        CancellationToken cancellationToken)
    {
        var bank = await _banks.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("题库不存在。");

        var questions = await _questions.GetByIdsAsync(bank.QuestionIds.ToList(), cancellationToken);
        return QuestionBankDtoFactory.ToDetail(bank, questions);
    }
}
