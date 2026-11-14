using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Learning.Commands;

/// <summary>标记已掌握：这道题不再留在错题本里。</summary>
public sealed record ResolveMistakeCommand(long QuestionId)
    : IAppCommand<MistakeDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class ResolveMistakeHandler : IRequestHandler<ResolveMistakeCommand, MistakeDto>
{
    private readonly IMistakeRepository _mistakes;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ResolveMistakeHandler(
        IMistakeRepository mistakes,
        IQuestionRepository questions,
        ITagRepository tags,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _mistakes = mistakes;
        _questions = questions;
        _tags = tags;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<MistakeDto> Handle(
        ResolveMistakeCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var mistake = await _mistakes.GetAsync(userId, request.QuestionId, cancellationToken)
            ?? throw new NotFoundException("错题本里没有这道题。");

        var now = _clock.UtcNow;
        mistake.Resolve(now);
        _mistakes.Update(mistake);

        await _audit.RecordAsync(
            "mistake.resolve",
            "mistake",
            mistake.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["userId"] = userId,
                ["questionId"] = mistake.QuestionId,
            },
            cancellationToken);

        var items = await MistakeDtoMapper.MapAsync([mistake], _questions, _tags, cancellationToken);
        return items[0];
    }
}
