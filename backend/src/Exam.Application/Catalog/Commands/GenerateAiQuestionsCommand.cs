using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Services;
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

/// <summary>
/// 用大模型生成试题。
/// <para>
/// 生成的题走**与文件导入同一套校验**：模型产的题也要满足单选只有一个答案、
/// 答案键得在选项里、步骤分值得对得上；通不过的题不落库，逐条说明原因。
/// 通得过的直接成为候选题（草稿），等人在候选题队列里复核发布。
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

public sealed class GenerateAiQuestionsCommandValidator : AbstractValidator<GenerateAiQuestionsCommand>
{
    public GenerateAiQuestionsCommandValidator()
    {
        RuleFor(x => x.Provider)
            .NotEmpty().WithMessage("请选择 AI 供应商。");

        RuleFor(x => x.Count)
            .InclusiveBetween(1, 10).WithMessage("一次最多生成 10 道题。");

        RuleFor(x => x.Type)
            .Must(BeKnownType).WithMessage("题型无法识别。");

        RuleFor(x => x.DifficultyTagId)
            .GreaterThan(0).WithMessage("请选择难度标签。");

        RuleFor(x => x.Prompt)
            .NotEmpty().WithMessage("请填写出题要求。")
            .MaximumLength(2000).WithMessage("出题要求过长。");

        RuleFor(x => x.TagIds)
            .Must(ids => ids is null || ids.Distinct().Count() <= Question.MaxTagCount)
            .WithMessage($"知识点标签不能超过 {Question.MaxTagCount} 个。");
    }

    private static bool BeKnownType(string type) =>
        QuestionTypes.FromName(type) is not null || QuestionTypes.FromStorage(type) is not null;
}

public sealed class GenerateAiQuestionsHandler
    : IRequestHandler<GenerateAiQuestionsCommand, AiGenerationResultDto>
{
    private readonly IEnumerable<IQuestionGenerationProvider> _providers;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public GenerateAiQuestionsHandler(
        IEnumerable<IQuestionGenerationProvider> providers,
        IQuestionRepository questions,
        ITagRepository tags,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _providers = providers;
        _questions = questions;
        _tags = tags;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<AiGenerationResultDto> Handle(
        GenerateAiQuestionsCommand request,
        CancellationToken cancellationToken)
    {
        var type = QuestionTypes.FromName(request.Type) ?? QuestionTypes.FromStorage(request.Type)
            ?? throw new BusinessRuleException("题型无法识别。");

        var provider = ResolveProvider(request.Provider);
        var model = ResolveModel(provider, request.Model);

        var difficulty = await _tags.GetByIdAsync(request.DifficultyTagId, cancellationToken);
        if (difficulty is null || difficulty.Group != TagGroup.Difficulty)
        {
            throw new BusinessRuleException("难度标签不存在或不是难度维度，请重新选择。");
        }

        var knowledgePoints = await ResolveKnowledgePointsAsync(
            request.TagIds,
            request.DifficultyTagId,
            cancellationToken);

        var generationRequest = new AiGenerationRequest(
            request.Prompt.Trim(),
            type,
            request.Count,
            difficulty.Name,
            knowledgePoints);

        var raw = await CallModelAsync(provider, generationRequest, model, cancellationToken);

        var now = _clock.UtcNow;
        var items = new List<AiGenerationItemDto>();
        var succeeded = 0;
        long? firstQuestionId = null;

        foreach (var (draft, index) in AiQuestionDraftParser.Parse(raw.RawContent).Select((d, i) => (d, i + 1)))
        {
            if (!draft.Succeeded || draft.Draft is null)
            {
                items.Add(AiGenerationItemDto.Failed(index, draft.Error ?? "模型没有给出这一题。"));
                continue;
            }

            // 题干里的出题痕迹（「答案 B」「4 个选项」）要去掉或拦下来：
            // 这样的题进了题库就是泄题。
            var (stem, stemProblems) = AiStemQuality.Check(draft.Draft.Stem);
            if (stemProblems.Count > 0)
            {
                items.Add(AiGenerationItemDto.Failed(index, stemProblems));
                continue;
            }

            // 模型产的题走导入那套规则：不合法就不落库，并说清哪里不合法。
            var (parsed, errors) = QuestionImportParser.Parse(
                AiDraftRowMapper.ToRow(draft.Draft with { Stem = stem }));
            if (parsed is null)
            {
                items.Add(AiGenerationItemDto.Failed(index, Describe(errors)));
                continue;
            }

            var code = await NextCodeAsync(now, index, cancellationToken);
            var question = QuestionComposer.Compose(
                parsed,
                code,
                difficulty.Id,
                request.TagIds,
                QuestionSource.Generated,
                batchId: null,
                now,
                _currentUser.UserId);

            try
            {
                // 发布校验：过了这一关，这道题才是能发布的候选题。
                question.EnsureValid();
            }
            catch (QuestionValidationException ex)
            {
                items.Add(AiGenerationItemDto.Failed(index, Describe(ex)));
                continue;
            }

            await _questions.AddAsync(question, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            succeeded++;
            firstQuestionId ??= question.Id;
            items.Add(AiGenerationItemDto.Ok(index, question));
        }

        await _audit.RecordAsync(
            "ai.generate",
            "question",
            (firstQuestionId ?? 0).ToString(),
            new Dictionary<string, object?>
            {
                ["provider"] = provider.Name,
                ["model"] = model,
                ["type"] = type.ToStorage(),
                ["requested"] = request.Count,
                ["succeeded"] = succeeded,
                ["failed"] = items.Count - succeeded,
            },
            cancellationToken);

        return new AiGenerationResultDto(
            provider.Name,
            provider.DisplayName,
            model,
            request.Count,
            succeeded,
            items.Count - succeeded,
            items);
    }

    private IQuestionGenerationProvider ResolveProvider(string name)
    {
        var providers = _providers.ToList();
        if (providers.Count == 0)
        {
            throw new AiProviderNotConfiguredException(
                "服务端没有配置任何 AI 服务。请先配置供应商与 API Key。");
        }

        var provider = providers.FirstOrDefault(
            p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));

        if (provider is null)
        {
            throw new AiProviderNotConfiguredException(
                $"没有名为「{name}」的 AI 服务。可用：{string.Join("、", providers.Select(p => p.DisplayName))}。");
        }

        if (!provider.IsConfigured)
        {
            throw new AiProviderNotConfiguredException(
                $"{provider.DisplayName} 尚未配置 API Key，无法生成试题。请让管理员在服务端配置后再试。");
        }

        return provider;
    }

    private static string ResolveModel(IQuestionGenerationProvider provider, string? model)
    {
        if (string.IsNullOrWhiteSpace(model))
        {
            return provider.DefaultModel;
        }

        var trimmed = model.Trim();
        if (!provider.Models.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
        {
            throw new BusinessRuleException($"供应商 {provider.DisplayName} 不支持模型「{trimmed}」。");
        }

        return trimmed;
    }

    private async Task<IReadOnlyList<string>> ResolveKnowledgePointsAsync(
        IReadOnlyList<long> tagIds,
        long difficultyTagId,
        CancellationToken cancellationToken)
    {
        if (tagIds.Count == 0)
        {
            return [];
        }

        var tags = await _tags.GetByIdsAsync(tagIds.Distinct().ToList(), cancellationToken);
        var byId = tags.ToDictionary(t => t.Id);
        var names = new List<string>();

        foreach (var id in tagIds.Distinct())
        {
            if (id == difficultyTagId)
            {
                throw new BusinessRuleException("难度标签不能同时作为知识点标签。");
            }

            if (!byId.TryGetValue(id, out var tag))
            {
                throw new BusinessRuleException($"知识点标签不存在（{id}），请重新选择。");
            }

            if (tag.Group == TagGroup.Organization)
            {
                throw new BusinessRuleException($"组织维度的标签「{tag.Name}」不能挂到题目上。");
            }

            names.Add(tag.Name);
        }

        return names;
    }

    private static async Task<AiGenerationResult> CallModelAsync(
        IQuestionGenerationProvider provider,
        AiGenerationRequest request,
        string model,
        CancellationToken cancellationToken)
    {
        try
        {
            return await provider.GenerateAsync(request, model, cancellationToken);
        }
        catch (AiGenerationFailedException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new AiGenerationFailedException($"调用 {provider.DisplayName}（{model}）失败：{ex.Message}");
        }
    }

    /// <summary>题号：AI-时间戳-序号。重了就往后排。</summary>
    private async Task<string> NextCodeAsync(
        DateTimeOffset now,
        int index,
        CancellationToken cancellationToken)
    {
        var baseCode = $"AI-{now:yyyyMMddHHmmss}-{index:D2}";
        var code = baseCode;
        var suffix = 1;

        while (await _questions.CodeExistsAsync(code, null, cancellationToken))
        {
            suffix++;
            code = $"{baseCode}-{suffix}";
        }

        return code;
    }

    private static IReadOnlyList<string> Describe(IReadOnlyList<ImportRowError> errors) =>
        errors.Select(e => $"{FieldLabel(e.Field)}：{e.Reason}").ToList();

    private static IReadOnlyList<string> Describe(QuestionValidationException ex)
    {
        if (ex.Errors.Count == 0)
        {
            return [ex.Message];
        }

        return ex.Errors
            .SelectMany(e => e.Value.Select(reason => $"{FieldLabel(e.Key)}：{reason}"))
            .ToList();
    }

    private static string FieldLabel(string field) => field switch
    {
        "stem" => "题干",
        "type" => "题型",
        "options" => "选项",
        "answer" => "答案",
        "steps" => "评分步骤",
        "analysis" => "解析",
        "referenceAnswer" => "参考答案",
        "score" => "分值",
        "difficulty" => "难度",
        "tags" => "知识点",
        _ => field,
    };
}
