using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Catalog.Services;
using Exam.Application.Common.Exceptions;

namespace Exam.Infrastructure.Ai;

/// <summary>
/// 按 OpenAI 兼容协议调用大模型。
/// <para>
/// MiniMax、DeepSeek、通义千问等多家厂商都提供这套协议：
/// <c>POST {BaseUrl}/chat/completions</c>，<c>Authorization: Bearer &lt;key&gt;</c>，
/// 取 <c>choices[0].message.content</c>。换厂商只是换一份配置。
/// </para>
/// </summary>
public sealed class OpenAiCompatibleGenerationProvider : IQuestionGenerationProvider
{
    /// <summary>HttpClient 名字。</summary>
    public const string HttpClientName = "ai-generation";

    private readonly string _name;
    private readonly AiProviderOptions _options;
    private readonly HttpClient _client;

    public OpenAiCompatibleGenerationProvider(
        string name,
        AiProviderOptions options,
        IHttpClientFactory httpClientFactory)
    {
        _name = name;
        _options = options;
        _client = httpClientFactory.CreateClient(HttpClientName);
    }

    public string Name => _name;

    public string DisplayName =>
        string.IsNullOrWhiteSpace(_options.DisplayName) ? _name : _options.DisplayName;

    public IReadOnlyList<string> Models => _options.Models;

    public string DefaultModel => !string.IsNullOrWhiteSpace(_options.DefaultModel)
        ? _options.DefaultModel
        : _options.Models.FirstOrDefault() ?? string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.ApiKey)
        && !string.IsNullOrWhiteSpace(_options.BaseUrl)
        && _options.Models.Count > 0;

    public async Task<AiGenerationResult> GenerateAsync(
        AiGenerationRequest request,
        string model,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new AiProviderNotConfiguredException(
                $"{DisplayName} 尚未配置 API Key，无法生成试题。");
        }

        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["messages"] = new[]
            {
                new Dictionary<string, string>
                {
                    ["role"] = "system",
                    ["content"] = AiQuestionPrompt.SystemPrompt,
                },
                new Dictionary<string, string>
                {
                    ["role"] = "user",
                    ["content"] = AiQuestionPrompt.BuildUserPrompt(request),
                },
            },
            ["temperature"] = _options.Temperature,
            ["max_tokens"] = _options.MaxTokens,
        };

        if (_options.JsonMode)
        {
            payload["response_format"] = new Dictionary<string, string> { ["type"] = "json_object" };
        }

        using var message = new HttpRequestMessage(
            HttpMethod.Post,
            $"{_options.BaseUrl.TrimEnd('/')}/chat/completions");

        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        message.Content = JsonContent.Create(payload);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(5, _options.TimeoutSeconds)));

        HttpResponseMessage response;
        try
        {
            response = await _client.SendAsync(message, timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new AiGenerationFailedException(
                $"调用 {DisplayName}（{model}）超时（{_options.TimeoutSeconds} 秒）。");
        }
        catch (HttpRequestException ex)
        {
            throw new AiGenerationFailedException($"无法连接 {DisplayName}：{ex.Message}");
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                throw new AiGenerationFailedException(
                    $"{DisplayName} 返回 {(int)response.StatusCode}：{Truncate(body)}");
            }

            var content = ExtractContent(body, DisplayName);

            if (string.IsNullOrWhiteSpace(content))
            {
                throw new AiGenerationFailedException($"{DisplayName} 没有返回内容。");
            }

            return new AiGenerationResult(content, model, _name);
        }
    }

    /// <summary>
    /// 从响应里取正文。
    /// <para>
    /// 取的是 <c>choices[0].message.content</c>。顺带认两家厂商的错误体：
    /// MiniMax 的 <c>base_resp</c> 与 OpenAI 风格的 <c>error</c>——
    /// 它们有时会带着 200 回来，不单独看就只会读到一句空内容。
    /// </para>
    /// </summary>
    private static string ExtractContent(string body, string displayName)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw new AiGenerationFailedException($"{displayName} 返回的不是 JSON：{ex.Message}");
        }

        using (document)
        {
            var root = document.RootElement;

            if (root.TryGetProperty("base_resp", out var baseResp)
                && baseResp.ValueKind == JsonValueKind.Object
                && baseResp.TryGetProperty("status_code", out var statusCode)
                && statusCode.TryGetInt32(out var code)
                && code != 0)
            {
                var message = baseResp.TryGetProperty("status_msg", out var statusMessage)
                    ? statusMessage.GetString()
                    : null;
                throw new AiGenerationFailedException(
                    $"{displayName} 报错：{message ?? $"错误码 {code}"}");
            }

            if (root.TryGetProperty("error", out var error))
            {
                var message = error.ValueKind == JsonValueKind.Object
                    && error.TryGetProperty("message", out var errorMessage)
                        ? errorMessage.GetString()
                        : error.GetRawText();
                throw new AiGenerationFailedException($"{displayName} 报错：{message}");
            }

            if (root.TryGetProperty("choices", out var choices)
                && choices.ValueKind == JsonValueKind.Array
                && choices.GetArrayLength() > 0)
            {
                var first = choices[0];

                if (first.TryGetProperty("message", out var messageElement)
                    && messageElement.ValueKind == JsonValueKind.Object
                    && messageElement.TryGetProperty("content", out var content)
                    && content.ValueKind == JsonValueKind.String)
                {
                    return content.GetString() ?? string.Empty;
                }

                // 老式补全接口的字段名。
                if (first.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                {
                    return text.GetString() ?? string.Empty;
                }
            }

            return string.Empty;
        }
    }

    private static string Truncate(string text, int max = 300) =>
        text.Length <= max ? text : text[..max] + "…";
}
