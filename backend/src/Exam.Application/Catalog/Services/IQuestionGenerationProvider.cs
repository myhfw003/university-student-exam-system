using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>一次试题生成的请求（供应商无关）。</summary>
/// <param name="Prompt">老师的出题要求。</param>
/// <param name="Type">题型。</param>
/// <param name="Count">要生成几道。</param>
/// <param name="DifficultyName">难度标签名。</param>
/// <param name="KnowledgePointNames">知识点标签名。</param>
public sealed record AiGenerationRequest(
    string Prompt,
    QuestionType Type,
    int Count,
    string DifficultyName,
    IReadOnlyList<string> KnowledgePointNames);

/// <summary>模型返回的原始文本。解析交给 <see cref="AiQuestionDraftParser"/>。</summary>
public sealed record AiGenerationResult(string RawContent, string Model, string Provider);

/// <summary>
/// 试题生成的**供应商接口**。
/// <para>
/// 应用层只认这个接口，不认具体厂商：换模型是换个 <c>model</c>，
/// 换厂商是换个实现。实现放在基础设施层（HTTP 调用在那儿）。
/// </para>
/// </summary>
public interface IQuestionGenerationProvider
{
    /// <summary>供应商标识（如 minimax）。</summary>
    string Name { get; }

    /// <summary>供应商中文名，界面上显示用。</summary>
    string DisplayName { get; }

    /// <summary>可切换的模型清单。</summary>
    IReadOnlyList<string> Models { get; }

    /// <summary>默认模型（未指定模型时用它）。</summary>
    string DefaultModel { get; }

    /// <summary>是否已配置可用（缺 API Key 时为 false，界面据此提示）。</summary>
    bool IsConfigured { get; }

    /// <summary>调用模型生成题目。返回模型的原始输出文本。</summary>
    Task<AiGenerationResult> GenerateAsync(
        AiGenerationRequest request,
        string model,
        CancellationToken cancellationToken);
}
