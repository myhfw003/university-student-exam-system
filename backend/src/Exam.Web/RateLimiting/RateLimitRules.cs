using System.Globalization;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Exam.Web.Security;
using Microsoft.AspNetCore.Routing;

namespace Exam.Web.RateLimiting;

/// <summary>限流档位。</summary>
internal enum RateLimitTier
{
    /// <summary>不参与限流：健康检查与指标端点。</summary>
    Exempt,

    /// <summary>登录：按来源 IP 与按账号双维度。</summary>
    Login,

    /// <summary>保存答案：按用户。</summary>
    Answers,

    /// <summary>切屏事件：按用户。</summary>
    FocusEvents,

    /// <summary>其余写端点：按用户。</summary>
    Write,

    /// <summary>读端点：兜底阈值，按登录用户（登录）或来源 IP（未登录）。</summary>
    Read,
}

/// <summary>
/// 限流档位与阈值。
/// <para>
/// 档位对应 docs/design/05-api.md §1.5：
/// 登录 10 次/分钟/IP + 5 次/分钟/账号；保存答案与切屏事件 120 次/分钟/用户；
/// 其余写端点 60 次/分钟/用户。超限返回 429 + Retry-After。
/// </para>
/// <para>
/// 读端点不在 §1.5 的表里，用兜底阈值。分区按登录用户（登录）或来源 IP（未登录）：
/// 一个考场共用出口 IP 时，按 IP 分区会让所有人互相饿死——先扣自己的额度，
/// 写端点更不能按 IP 分。
/// </para>
/// <para>
/// 阈值在请求时读配置：改完立刻生效，不用重启。分区键里带上阈值，
/// 阈值一改就换一个分区，新阈值立即接管——不然旧的分区会一直用老额度。
/// </para>
/// </summary>
internal static class RateLimitRules
{
    /// <summary>路由模板里的参数约束（如 {id:long}）。</summary>
    private static readonly Regex RouteConstraintRegex = new(@"\{(\w+):[^}]+\}", RegexOptions.Compiled);

    public const string LoginRouteTemplate = "api/v1/auth/login";
    public const string AnswersRouteTemplate = "api/v1/attempts/{id}/answers";
    public const string FocusEventsRouteTemplate = "api/v1/attempts/{id}/focus-events";

    public const string LoginPerIpPerMinuteKey = "RateLimiting:LoginPerIpPerMinute";
    public const string LoginPerAccountPerMinuteKey = "RateLimiting:LoginPerAccountPerMinute";
    public const string AnswersPerUserPerMinuteKey = "RateLimiting:AnswersPerUserPerMinute";
    public const string FocusEventsPerUserPerMinuteKey = "RateLimiting:FocusEventsPerUserPerMinute";
    public const string WritesPerUserPerMinuteKey = "RateLimiting:WritesPerUserPerMinute";
    public const string ReadsPerMinuteKey = "RateLimiting:ReadsPerMinute";

    public const int DefaultLoginPerIpPerMinute = 10;
    public const int DefaultLoginPerAccountPerMinute = 5;
    public const int DefaultAnswersPerUserPerMinute = 120;
    public const int DefaultFocusEventsPerUserPerMinute = 120;
    public const int DefaultWritesPerUserPerMinute = 60;
    public const int DefaultReadsPerMinute = 6000;

    /// <summary>判定请求命中的限流档位。</summary>
    public static RateLimitTier TierOf(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // 健康检查与指标不参与限流：探针被限流，容器会被判成不健康。
        if (path.StartsWith("/health", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/metrics", StringComparison.OrdinalIgnoreCase))
        {
            return RateLimitTier.Exempt;
        }

        if (!IsWriteMethod(context.Request.Method))
        {
            return RateLimitTier.Read;
        }

        if (MatchesRoute(context, LoginRouteTemplate))
        {
            return RateLimitTier.Login;
        }

        if (MatchesRoute(context, AnswersRouteTemplate))
        {
            return RateLimitTier.Answers;
        }

        if (MatchesRoute(context, FocusEventsRouteTemplate))
        {
            return RateLimitTier.FocusEvents;
        }

        return RateLimitTier.Write;
    }

    /// <summary>读请求时读配置里的阈值。</summary>
    public static int LimitOf(HttpContext context, string key, int fallback)
    {
        var value = context.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetValue(key, fallback);

        return value > 0 ? value : fallback;
    }

    /// <summary>来源 IP 分区键。</summary>
    public static string IpKey(HttpContext context, string prefix, int limit) =>
        $"{prefix}:ip:{ClientIp(context)}:{limit}";

    /// <summary>账号分区键。账号名大小写不敏感（查库就是按小写比的），键也按小写归一，
    /// 否则换个大小写就能绕过「每账号」的额度。</summary>
    public static string AccountKey(HttpContext context, string prefix, int limit)
    {
        var account = LoginAccountMiddleware.AccountOf(context);
        return account is null
            ? $"{prefix}:acct:unknown:{limit}"
            : $"{prefix}:acct:{account}:{limit}";
    }

    /// <summary>用户分区键。未登录时退回来源 IP。</summary>
    public static string UserKey(HttpContext context, string prefix, int limit)
    {
        var userId = UserId(context);
        return userId is null
            ? $"{prefix}:ip:{ClientIp(context)}:{limit}"
            : $"{prefix}:u:{userId}:{limit}";
    }

    /// <summary>
    /// 客户端来源 IP。经反向代理转发头处理后，这里已经是真实客户端地址。
    /// <para>
    /// 归一过 IPv4 映射的 IPv6：同一台机器经代理（干净的 IPv4）与直连
    /// （映射地址）两条路进来时，必须落进同一个限流桶，否则额度凭空翻倍。
    /// </para>
    /// </summary>
    public static string ClientIp(HttpContext context) =>
        ClientAddress.Normalize(context.Connection.RemoteIpAddress) ?? "unknown";

    /// <summary>当前登录用户标识，未登录或令牌无效时为空。</summary>
    public static string? UserId(HttpContext context)
    {
        var principal = context.User;
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue("sub");

        return long.TryParse(value, out var id) ? id.ToString(CultureInfo.InvariantCulture) : null;
    }

    /// <summary>
    /// 去掉路由模板里的约束：控制器上写的是 <c>{id:long}</c>，
    /// 模板原文带着约束，比对不上就把约束摘掉再比。
    /// </summary>
    private static string NormalizeRoute(string route) =>
        RouteConstraintRegex.Replace(route, "{$1}");

    private static bool IsWriteMethod(string method) =>
        HttpMethods.IsPost(method)
        || HttpMethods.IsPut(method)
        || HttpMethods.IsPatch(method)
        || HttpMethods.IsDelete(method);

    private static bool MatchesRoute(HttpContext context, string routeTemplate)
    {
        var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
        if (!string.IsNullOrEmpty(route))
        {
            return string.Equals(NormalizeRoute(route), routeTemplate, StringComparison.OrdinalIgnoreCase);
        }

        // 路由没匹配上（404 或非控制器端点）：退回按路径判定。
        var path = context.Request.Path.Value ?? string.Empty;
        return routeTemplate switch
        {
            LoginRouteTemplate => path.EndsWith("/auth/login", StringComparison.OrdinalIgnoreCase),
            AnswersRouteTemplate => path.Contains("/attempts/", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith("/answers", StringComparison.OrdinalIgnoreCase),
            FocusEventsRouteTemplate => path.Contains("/attempts/", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith("/focus-events", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }
}
