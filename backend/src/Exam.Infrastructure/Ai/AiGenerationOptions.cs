namespace Exam.Infrastructure.Ai;

/// <summary>
/// AI 生成的配置。
/// <para>
/// <b>API Key 不进仓库</b>：配置里只留空的 <c>ApiKey</c>，
/// 真值由环境变量给（<c>AiGeneration__Providers__&lt;厂商&gt;__ApiKey</c>）。
/// </para>
/// </summary>
public sealed class AiGenerationOptions
{
    /// <summary>配置节名。</summary>
    public const string SectionName = "AiGeneration";

    /// <summary>是否启用 AI 生成。关掉后界面直接看不到入口。</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>默认供应商（界面上默认选中哪个）。</summary>
    public string DefaultProvider { get; set; } = "minimax";

    /// <summary>供应商配置：名字 → 配置。</summary>
    public Dictionary<string, AiProviderOptions> Providers { get; set; } = [];
}

/// <summary>单个供应商的配置。</summary>
public sealed class AiProviderOptions
{
    /// <summary>界面上显示的名字。</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>OpenAI 兼容接口的根地址（如 https://api.minimaxi.com/v1）。</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>API Key。留空即视为未配置。</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>默认模型。</summary>
    public string DefaultModel { get; set; } = string.Empty;

    /// <summary>可切换的模型清单。</summary>
    public List<string> Models { get; set; } = [];

    /// <summary>采样温度。</summary>
    public double Temperature { get; set; } = 0.7;

    /// <summary>单次生成的最大 token 数。</summary>
    public int MaxTokens { get; set; } = 8192;

    /// <summary>调用超时（秒）。</summary>
    public int TimeoutSeconds { get; set; } = 180;

    /// <summary>是否要求模型输出 JSON 对象（response_format=json_object）。</summary>
    public bool JsonMode { get; set; } = true;
}
