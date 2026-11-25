using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Domain.Audit;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 客户端来源地址：限流按**局域网地址**分桶，这个地址必须不可伪造。
/// <para>
/// 限流的「每 IP」档位与审计记的 IP 都取自同一个地址。两处要一致，
/// 而且这个地址只能由连接本身决定——<c>X-Forwarded-For</c> 是客户端可控的头，
/// 只有当请求来自**受信任的反向代理**时才认它。
/// </para>
/// <para>
/// 部署形态是局域网：每个考场机器各有地址，所以「每 IP」就是「每台机器」。
/// 反过来，局域网里的机器直连 API 端口时若能自带 <c>X-Forwarded-For</c>，
/// 就能给每次请求换一个限流桶——登录爆破就绕过去了，审计里的 IP 也全是假的。
/// </para>
/// </summary>
public sealed class ClientAddressTests : IAsyncLifetime
{
    /// <summary>测试里当作「反向代理」的可信网段。</summary>
    private const string TrustedProxyNetwork = "10.99.0.0/24";

    /// <summary>测试里当作「考场局域网」的地址（不在受信任网段里）。</summary>
    private const string ExamRoomAddress = "172.16.90.77";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 来源不在受信任网段时伪造的转发头不改变限流分桶()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["ForwardedHeaders:KnownNetworks:0"] = TrustedProxyNetwork,
                ["RateLimiting:LoginPerIpPerMinute"] = "3",
                ["RateLimiting:LoginPerAccountPerMinute"] = "100",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        // 每次请求都换一个伪造的 X-Forwarded-For：采信了它，每次就是一个新桶，
        // 阈值形同虚设。不采信的话，它们全落在同一个桶里。
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 6; i++)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
            {
                Content = JsonContent.Create(new { username = $"forged{i:D2}", password = "Pass123456" }),
            };
            request.Headers.Add("X-Test-Remote-Ip", ExamRoomAddress);
            request.Headers.Add("X-Forwarded-For", $"203.0.113.{i}");

            var response = await client.SendAsync(request);
            statuses.Add(response.StatusCode);
        }

        statuses.ShouldContain(
            HttpStatusCode.TooManyRequests,
            $"伪造的转发头被采信了，限流没兜住：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 来源不在受信任网段时审计记的是连接本身的地址()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["ForwardedHeaders:KnownNetworks:0"] = TrustedProxyNetwork,
                ["RateLimiting:LoginPerIpPerMinute"] = "100",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new { username = "forgedaudit01", password = "Pass123456" }),
        };
        request.Headers.Add("X-Test-Remote-Ip", ExamRoomAddress);
        request.Headers.Add("X-Forwarded-For", "203.0.113.200");

        await client.SendAsync(request);

        var ip = await LastLoginIpAsync(factory);
        ip.ShouldBe(ExamRoomAddress, "审计记的来源地址应当是连接本身的地址，不是客户端自带的转发头");
    }

    [Fact]
    public async Task 受信任代理带来的转发头被采信()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["ForwardedHeaders:KnownNetworks:0"] = TrustedProxyNetwork,
                ["RateLimiting:LoginPerIpPerMinute"] = "100",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        // 请求来自受信任网段（反向代理），转发头里是它看到的客户端地址。
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new { username = "trustedproxy01", password = "Pass123456" }),
        };
        request.Headers.Add("X-Test-Remote-Ip", "10.99.0.9");
        request.Headers.Add("X-Forwarded-For", "192.168.31.24");

        await client.SendAsync(request);

        var ip = await LastLoginIpAsync(factory);
        ip.ShouldBe("192.168.31.24", "受信任代理带来的转发头应当被采信");
    }

    [Fact]
    public void IPv4映射地址与IPv4归一成同一个来源地址()
    {
        // 直连进来的对端地址在 .NET 里是 IPv4 映射的 IPv6，
        // 经转发头处理过的是干净的 IPv4。归一之后同一个客户端只有一个限流桶。
        var mapped = IPAddress.Parse("::ffff:192.168.31.24");
        var plain = IPAddress.Parse("192.168.31.24");

        Exam.Web.Security.ClientAddress.Normalize(mapped)
            .ShouldBe(Exam.Web.Security.ClientAddress.Normalize(plain));
        Exam.Web.Security.ClientAddress.Normalize(mapped).ShouldBe("192.168.31.24");
    }

    /// <summary>最近一条登录审计记的来源地址。</summary>
    private static async Task<string?> LastLoginIpAsync(ExamWebFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // 登录成功记 auth.login，失败记 auth.login_failed：两条都要看。
        var log = await db.Set<AuditLog>()
            .Where(x => x.Action.StartsWith("auth.login"))
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync();

        return log?.IpAddress;
    }
}
