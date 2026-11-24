using System.Globalization;
using System.Threading.RateLimiting;
using Exam.Application.Common.Interfaces;
using Exam.Domain.SharedKernel.Exceptions;
using Exam.Web.Middleware;
using Microsoft.AspNetCore.RateLimiting;

namespace Exam.Web.RateLimiting;

/// <summary>
/// 装配限流器。
/// <para>
/// 三个分区器串联：按来源 IP（登录）、按账号（登录）、按用户（写端点与读端点）。
/// 串联的语义是「都要通过」：登录同时受 IP 与账号两个维度约束，
/// 其余端点只有一个维度生效，不生效的维度直接放行。
/// </para>
/// <para>
/// 档位与阈值见 <see cref="RateLimitRules"/>，对应 docs/design/05-api.md §1.5。
/// </para>
/// </summary>
internal static class ExamRateLimiter
{
    /// <summary>统计窗口：一分钟。</summary>
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    /// <summary>超限后建议的等待时间（拿不到更准的值时用这个）。</summary>
    private static readonly TimeSpan FallbackRetryAfter = TimeSpan.FromSeconds(60);

    public static void Configure(RateLimiterOptions options)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.GlobalLimiter = PartitionedRateLimiter.CreateChained(
            IpLimiter(),
            AccountLimiter(),
            UserLimiter());
        options.OnRejected = RejectedAsync;
    }

    /// <summary>登录端点的来源 IP 维度：10 次/分钟/IP。</summary>
    private static PartitionedRateLimiter<HttpContext> IpLimiter() =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
        {
            if (RateLimitRules.TierOf(context) != RateLimitTier.Login)
            {
                return RateLimitPartition.GetNoLimiter("noop");
            }

            var limit = RateLimitRules.LimitOf(
                context,
                RateLimitRules.LoginPerIpPerMinuteKey,
                RateLimitRules.DefaultLoginPerIpPerMinute);

            return FixedWindow(RateLimitRules.IpKey(context, "login-ip", limit), limit);
        });

    /// <summary>登录端点的账号维度：5 次/分钟/账号。</summary>
    private static PartitionedRateLimiter<HttpContext> AccountLimiter() =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
        {
            if (RateLimitRules.TierOf(context) != RateLimitTier.Login)
            {
                return RateLimitPartition.GetNoLimiter("noop");
            }

            if (LoginAccountMiddleware.AccountOf(context) is null)
            {
                // 读不出账号就不按账号限：这一维不生效，IP 维度仍然兜着。
                return RateLimitPartition.GetNoLimiter("noop");
            }

            var limit = RateLimitRules.LimitOf(
                context,
                RateLimitRules.LoginPerAccountPerMinuteKey,
                RateLimitRules.DefaultLoginPerAccountPerMinute);

            return FixedWindow(RateLimitRules.AccountKey(context, "login-acct", limit), limit);
        });

    /// <summary>写端点与读端点的用户维度。</summary>
    private static PartitionedRateLimiter<HttpContext> UserLimiter() =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
        {
            var tier = RateLimitRules.TierOf(context);
            if (tier is RateLimitTier.Exempt or RateLimitTier.Login)
            {
                return RateLimitPartition.GetNoLimiter("noop");
            }

            var (prefix, limit) = tier switch
            {
                RateLimitTier.Answers => (
                    "answers",
                    RateLimitRules.LimitOf(
                        context,
                        RateLimitRules.AnswersPerUserPerMinuteKey,
                        RateLimitRules.DefaultAnswersPerUserPerMinute)),
                RateLimitTier.FocusEvents => (
                    "focus-events",
                    RateLimitRules.LimitOf(
                        context,
                        RateLimitRules.FocusEventsPerUserPerMinuteKey,
                        RateLimitRules.DefaultFocusEventsPerUserPerMinute)),
                RateLimitTier.Write => (
                    "write",
                    RateLimitRules.LimitOf(
                        context,
                        RateLimitRules.WritesPerUserPerMinuteKey,
                        RateLimitRules.DefaultWritesPerUserPerMinute)),
                _ => (
                    "read",
                    RateLimitRules.LimitOf(
                        context,
                        RateLimitRules.ReadsPerMinuteKey,
                        RateLimitRules.DefaultReadsPerMinute)),
            };

            return FixedWindow(RateLimitRules.UserKey(context, prefix, limit), limit);
        });

    /// <summary>
    /// 一分钟固定窗口的分区。
    /// <para>
    /// 计数器目前是进程内的（.NET 内置 <see cref="FixedWindowRateLimiter"/>）：
    /// 多实例部署时每个实例各算各的，实际额度会随实例数放大。
    /// 真要跨实例共享，换成 Redis 计数即可——限流器只依赖这里的工厂方法。
    /// </para>
    /// </summary>
    private static RateLimitPartition<string> FixedWindow(string key, int limit) =>
        RateLimitPartition.Get(
            key,
            _ => new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
            {
                PermitLimit = limit,
                Window = Window,
                QueueLimit = 0,
            }));

    /// <summary>超限响应：429 + Retry-After + 带错误码的 ProblemDetails。</summary>
    private static async ValueTask RejectedAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var httpContext = context.HttpContext;

        var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry)
            ? TimeSpan.FromSeconds(Math.Max(1, Math.Ceiling(retry.TotalSeconds)))
            : FallbackRetryAfter;

        httpContext.Response.Headers.RetryAfter =
            ((int)retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);

        var tier = RateLimitRules.TierOf(httpContext);

        var logger = httpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Exam.RateLimiting");
        logger.LogWarning(
            "触发限流：{Tier} {Method} {Path}",
            tier,
            httpContext.Request.Method,
            httpContext.Request.Path);

        httpContext.RequestServices.GetRequiredService<IExamMetrics>().RecordRateLimited(tier.ToString());

        await ProblemDetailsWriter.WriteAsync(
            httpContext,
            ErrorCodes.RateLimitExceeded,
            "操作过于频繁，请稍后再试。",
            StatusCodes.Status429TooManyRequests,
            null);
    }
}
