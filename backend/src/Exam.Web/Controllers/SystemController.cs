using Exam.Application.Common.Markers;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>系统接口。服务端时间是考试计时权威的基准（P-06）。</summary>
[ApiController]
[Route("api/v1/system")]
[AllowAnonymous]
public sealed class SystemController : ControllerBase
{
    private readonly IMediator _mediator;

    public SystemController(IMediator mediator) => _mediator = mediator;

    /// <summary>返回服务端当前时间，供客户端校准时钟偏移。</summary>
    [HttpGet("time")]
    [ProducesResponseType(typeof(ServerTimeResponse), StatusCodes.Status200OK)]
    public async Task<ServerTimeResponse> GetTime(CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        var now = DateTimeOffset.UtcNow;
        return new ServerTimeResponse(now, now.UtcTicks);
    }
}

public sealed record ServerTimeResponse(DateTimeOffset ServerTime, long MonotonicTime);
