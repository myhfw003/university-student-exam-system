using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Services;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using FluentValidation.Results;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>
/// 用大模型生成试题。
/// <para>
/// 生成的题走**与文件导入相同的校验**：模型产的题也要满足单选只有一个正确答案、
/// 多选至少两个、答案键必须在选项内、评分步骤分值之和等于题目分值等；
/// 通不过的题**不落库**并逐条说明原因，通过的落为草稿候选题。
/// </para>
/// </summary>
public sealed record GenerateAiQuestionsCommand(
    string Provider,
    string? Model,
    int Count,
    string Type,
    long DifficultyTagId,
    IReadOnlyList<long> TagIds,
    string Prompt)
    : IAppCommand<AiGenerationResultDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AiGenerate];
}

/// <summary>
/// 命令的请求校验。
/// <para>
/// 规则本身在 <see cref="AiGenerationRequestRules"/>——**流式入口也用那一份**，
/// 两边各写一套必然漂移（流式入口少一条限制，就等于少一道闸）。
/// </para>
/// </summary>
public sealed class GenerateAiQuestionsCommandValidator : AbstractValidator<GenerateAiQuestionsCommand>
{
    public GenerateAiQuestionsCommandValidator()
    {
        RuleFor(x => x)
            .Custom((command, context) =>
            {
                var errors = AiGenerationRequestRules.Validate(
                    command.Provider,
                    command.Count,
                    command.Type,
                    command.DifficultyTagId,
                    command.TagIds,
                    command.Prompt);

                foreach (var (field, messages) in errors)
                {
                    foreach (var message in messages)
                    {
                        context.AddFailure(new ValidationFailure(field, message));
                    }
                }
            });
    }
}

/// <summary>
/// 一次性拿到整批结果。
/// <para>
/// 底层是流式的（题目一道道落库），这里只是把事件收齐再一次性返回；
/// 要看进度就用 <c>POST /ai/generations/stream</c>。
/// </para>
/// </summary>
public sealed class GenerateAiQuestionsHandler : IRequestHandler<GenerateAiQuestionsCommand, AiGenerationResultDto>
{
    private readonly AiQuestionGenerationService _generation;

    public GenerateAiQuestionsHandler(AiQuestionGenerationService generation) => _generation = generation;

    public async Task<AiGenerationResultDto> Handle(
        GenerateAiQuestionsCommand request,
        CancellationToken cancellationToken)
    {
        var type = QuestionTypes.FromName(request.Type) ?? QuestionTypes.FromStorage(request.Type)
            ?? throw new BusinessRuleException("题型无法识别。");

        var parameters = new AiGenerationParameters(
            request.Provider,
            request.Model,
            request.Count,
            type,
            request.DifficultyTagId,
            request.TagIds ?? [],
            request.Prompt);

        var items = new List<AiGenerationItemDto>();
        AiGenerationCompletedEvent? completed = null;

        await foreach (var evt in _generation.GenerateAsync(parameters, cancellationToken))
        {
            switch (evt)
            {
                case AiQuestionReadyEvent ready:
                    items.Add(new AiGenerationItemDto(
                        ready.Index, true, ready.QuestionId, ready.Code, ready.Stem, []));
                    break;

                case AiQuestionFailedEvent failed:
                    items.Add(new AiGenerationItemDto(
                        failed.Index, false, null, null, null, [failed.Error]));
                    break;

                case AiGenerationCompletedEvent done:
                    completed = done;
                    break;
            }
        }

        return new AiGenerationResultDto(
            completed?.Provider ?? request.Provider,
            completed?.ProviderName ?? request.Provider,
            completed?.Model ?? request.Model ?? string.Empty,
            request.Count,
            items.Count(i => i.Succeeded),
            items.Count(i => !i.Succeeded),
            items);
    }
}
