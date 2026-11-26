using System.Runtime.CompilerServices;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// AI 生成试题的引擎。
/// <para>
/// **流式**：模型的输出边到边解析，凑齐一道题就落一次库、抛一个事件——
/// 老师能看着题目一道道进候选题队列，不用等整批出完
/// （8 道题实测要 25–60 秒，等整批很熬人）。
/// </para>
/// <para>
/// 校验与文件导入**共用同一套规则**：模型产的题要过同一道关，
/// 通不过的题不落库、逐条说明原因。
/// </para>
/// </summary>
public sealed class AiQuestionGenerationService
{
    private readonly IEnumerable<IQuestionGenerationProvider> _providers;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AiQuestionGenerationService(
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

    /// <summary>
    /// 生成试题，逐题产出事件。
    /// <para>配置类错误（没配 Key、供应商不对）在第一个事件之前抛出，
    /// 调用方还能按普通错误响应回去；生成过程中的问题则走事件。</para>
    /// </summary>
    public async IAsyncEnumerable<AiGenerationEvent> GenerateAsync(
        AiGenerationParameters parameters,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var provider = ResolveProvider(parameters.Provider);
        var model = ResolveModel(provider, parameters.Model);

        var difficulty = await _tags.GetByIdAsync(parameters.DifficultyTagId, cancellationToken);
        if (difficulty is null || difficulty.Group != TagGroup.Difficulty)
        {
            throw new BusinessRuleException("难度标签不存在或不是难度维度，请重新选择。");
        }

        var knowledgePoints = await ResolveKnowledgePointsAsync(
            parameters.TagIds,
            parameters.DifficultyTagId,
            cancellationToken);

        var request = new AiGenerationRequest(
            parameters.Prompt.Trim(),
            parameters.Type,
            parameters.Count,
            difficulty.Name,
            knowledgePoints);

        var now = _clock.UtcNow;
        var scanner = new AiQuestionStreamScanner();
        var index = 0;
        var succeeded = 0;
        var failed = 0;
        long? firstQuestionId = null;

        try
        {
            await foreach (var chunk in provider
                .GenerateStreamAsync(request, model, cancellationToken)
                .WithCancellation(cancellationToken))
            {
                foreach (var json in scanner.Feed(chunk))
                {
                    var (evt, ok) = await HandleQuestionAsync(
                        json,
                        ++index,
                        difficulty.Id,
                        parameters.TagIds,
                        now,
                        cancellationToken);

                    if (ok)
                    {
                        succeeded++;
                        firstQuestionId ??= (evt as AiQuestionReadyEvent)?.QuestionId;
                    }
                    else
                    {
                        failed++;
                    }

                    yield return evt;
                }
            }

            // 收尾：模型被截断时最后一道可能没凑完，能解析就算。
            var tail = scanner.Flush();
            if (tail is not null)
            {
                var (evt, ok) = await HandleQuestionAsync(
                    tail,
                    ++index,
                    difficulty.Id,
                    parameters.TagIds,
                    now,
                    cancellationToken);

                if (ok)
                {
                    succeeded++;
                    firstQuestionId ??= (evt as AiQuestionReadyEvent)?.QuestionId;
                }
                else
                {
                    failed++;
                }

                yield return evt;
            }
        }
        finally
        {
            // 审计放在 finally 里：**出到一半失败也要留痕**。
            // 题目是一道道落库的，中途失败时前面那几道已经在库里了——
            // 不记这条审计，就成了「有几道题没人知道从哪来的」。
            //
            // 用 CancellationToken.None：请求被取消（客户端断开）时
            // 审计仍要写完，否则正是最该留痕的情况反而没记录。
            await _audit.RecordAsync(
                "ai.generate",
                "question",
                (firstQuestionId ?? 0).ToString(),
                new Dictionary<string, object?>
                {
                    ["provider"] = provider.Name,
                    ["model"] = model,
                    ["type"] = parameters.Type.ToStorage(),
                    ["requested"] = parameters.Count,
                    ["succeeded"] = succeeded,
                    ["failed"] = failed,
                },
                CancellationToken.None);

            // 审计记录要自己落库：流式端点绕过了 MediatR 的工作单元管道，
            // 没人替它提交——不显式提交，这条「谁在什么时候生成了题」就丢了。
            await _unitOfWork.SaveChangesAsync(CancellationToken.None);
        }

        yield return new AiGenerationCompletedEvent(
            parameters.Count,
            succeeded,
            failed,
            provider.Name,
            provider.DisplayName,
            model);
    }

    /// <summary>一道题：解析 → 校验 → 落库 → 产出事件。</summary>
    private async Task<(AiGenerationEvent Event, bool Ok)> HandleQuestionAsync(
        string json,
        int index,
        long difficultyTagId,
        IReadOnlyList<long> tagIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var draft = AiQuestionDraftParser.ParseQuestion(json);
        if (!draft.Succeeded || draft.Draft is null)
        {
            return (new AiQuestionFailedEvent(index, draft.Error ?? "模型没有给出这一题。"), false);
        }

        // 题干里的出题痕迹（「答案 B」「4 个选项」）要去掉或拦下来：
        // 这样的题进了题库就是泄题。
        var (stem, stemProblems) = AiStemQuality.Check(draft.Draft.Stem);
        if (stemProblems.Count > 0)
        {
            return (new AiQuestionFailedEvent(index, string.Join("；", stemProblems)), false);
        }

        // 模型产的题走导入那套规则：不合法就不落库，并说清哪里不合法。
        var (parsed, errors) = QuestionImportParser.Parse(
            AiDraftRowMapper.ToRow(draft.Draft with { Stem = stem }));

        if (parsed is null)
        {
            return (
                new AiQuestionFailedEvent(
                    index,
                    string.Join("；", errors.Select(e => $"{e.Field}：{e.Reason}"))),
                false);
        }

        var code = await NextCodeAsync(now, index, cancellationToken);
        var question = QuestionComposer.Compose(
            parsed,
            code,
            difficultyTagId,
            tagIds,
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
            return (new AiQuestionFailedEvent(index, Describe(ex)), false);
        }

        await _questions.AddAsync(question, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return (
            new AiQuestionReadyEvent(
                index,
                question.Id,
                question.Code,
                parsed.Type.ToStorage(),
                parsed.Stem,
                parsed.Score),
            true);
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

    private static string Describe(QuestionValidationException ex)
    {
        if (ex.Errors.Count == 0)
        {
            return ex.Message;
        }

        return string.Join(
            "；",
            ex.Errors.SelectMany(e => e.Value.Select(reason => $"{e.Key}：{reason}")));
    }
}
