using Exam.Domain.SharedKernel.Abstractions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>系统接口。服务端时间是考试计时权威的基准（P-06）。</summary>
[ApiController]
[Route("api/v1/system")]
[AllowAnonymous]
public sealed class SystemController : ControllerBase
{
    private readonly IClock _clock;

    public SystemController(IClock clock) => _clock = clock;

    /// <summary>
    /// 返回服务端当前时间，供客户端校准时钟偏移。
    /// <para>
    /// 客户端可以多次采样取中位数来抵消网络抖动；偏移超过阈值时前端应提示考生。
    /// 考试计时始终以服务端时间为准，改本机系统时间没有任何用。
    /// </para>
    /// </summary>
    [HttpGet("time")]
    [ProducesResponseType(typeof(ServerTimeResponse), StatusCodes.Status200OK)]
    public ServerTimeResponse GetTime()
    {
        var now = _clock.UtcNow;
        return new ServerTimeResponse(now, now.UtcTicks, now.ToUnixTimeMilliseconds());
    }
}

/// <summary>服务端时间响应。</summary>
public sealed record ServerTimeResponse(
    DateTimeOffset ServerTime,
    long MonotonicTime,
    long EpochMilliseconds);
