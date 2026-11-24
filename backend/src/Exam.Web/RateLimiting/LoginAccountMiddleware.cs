using System.Text.Json;

namespace Exam.Web.RateLimiting;

/// <summary>
/// 取出登录请求里的账号名，供「每账号 5 次/分钟」这一维限流使用。
/// <para>
/// 账号名在请求体里，而模型绑定要到控制器才发生，限流又必须发生在控制器之前，
/// 所以这里先把请求体缓冲下来读出 username，再把流位置拨回去，
/// 后面的模型绑定照常读到完整请求体。
/// </para>
/// <para>
/// 只碰登录端点：其余请求连请求体都不打开。请求体不是合法 JSON、
/// 或者没有 username 字段时，这一维限流不生效（IP 维度仍然兜着）——
/// 读不出账号就别硬猜一个键。
/// </para>
/// </summary>
public sealed class LoginAccountMiddleware
{
    /// <summary>登录请求体里账号名的字段名。</summary>
    private const string UsernameField = "username";

    /// <summary>放账号名的位置。请求级缓存，避免重复读请求体。</summary>
    private const string ItemKey = "exam.login-account";

    /// <summary>登录请求体上限。超过这个大小就不是正常登录请求了。</summary>
    private const int MaxBodyBytes = 4096;

    private readonly RequestDelegate _next;

    public LoginAccountMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        if (RateLimitRules.TierOf(context) == RateLimitTier.Login)
        {
            var account = await ReadAccountAsync(context.Request);
            if (account is not null)
            {
                context.Items[ItemKey] = account;
            }
        }

        await _next(context);
    }

    /// <summary>当前请求里的账号名（已去空白并转小写），没有则为空。</summary>
    public static string? AccountOf(HttpContext context) =>
        context.Items.TryGetValue(ItemKey, out var value) ? value as string : null;

    private static async Task<string?> ReadAccountAsync(HttpRequest request)
    {
        if (request.ContentLength is > MaxBodyBytes)
        {
            return null;
        }

        request.EnableBuffering();
        if (!request.Body.CanSeek)
        {
            return null;
        }

        request.Body.Position = 0;

        // 有上限地读：分块请求没有 Content-Length，不设限就是往内存里灌。
        var buffer = new char[MaxBodyBytes + 1];
        var read = 0;
        try
        {
            using var reader = new StreamReader(request.Body, leaveOpen: true);
            while (read < buffer.Length)
            {
                var count = await reader.ReadAsync(buffer.AsMemory(read, buffer.Length - read));
                if (count == 0)
                {
                    break;
                }

                read += count;
            }
        }
        catch (IOException)
        {
            request.Body.Position = 0;
            return null;
        }

        if (read > MaxBodyBytes)
        {
            // 正常登录请求体只有几十字节，这么大的是别的东西。
            request.Body.Position = 0;
            return null;
        }

        var body = new string(buffer, 0, read);

        // 读过的流要拨回去：不然后面的模型绑定会读到空请求体。
        request.Body.Position = 0;

        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty(UsernameField, out var username)
                || username.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var value = username.GetString();
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
