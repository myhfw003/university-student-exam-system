using Exam.Application.Catalog.Services;
using Exam.Domain.Catalog;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 测试用的 AI 供应商。
/// <para>
/// 真实实现要发 HTTP 到模型服务，功能测试里不能真调（慢、贵、还不稳）。
/// 这里换成可控的假供应商：模型返回什么由测试自己写，返回的请求也留着可查。
/// </para>
/// </summary>
internal sealed class StubAiProvider : IQuestionGenerationProvider
{
    /// <summary>模型返回的原文。</summary>
    public string Content { get; set; } = "[]";

    /// <summary>是否已配置（缺 API Key 的情形用 false）。</summary>
    public bool IsConfigured { get; set; } = true;

    /// <summary>最近一次收到的请求。</summary>
    public AiGenerationRequest? LastRequest { get; private set; }

    public string Name => "stub";

    public string DisplayName => "测试模型";

    public IReadOnlyList<string> Models { get; set; } = ["stub-model", "stub-model-fast"];

    public string DefaultModel => Models[0];

    public Task<AiGenerationResult> GenerateAsync(
        AiGenerationRequest request,
        string model,
        CancellationToken cancellationToken)
    {
        LastRequest = request;

        if (!IsConfigured)
        {
            throw new Application.Common.Exceptions.AiProviderNotConfiguredException(
                "测试模型尚未配置 API Key，无法生成试题。");
        }

        return Task.FromResult(new AiGenerationResult(Content, model, Name));
    }
}
