namespace Exam.Web.HealthChecks;

/// <summary>
/// 容器健康检查探针。以独立进程方式运行，只发一个 HTTP 请求，
/// 不启动整个应用（否则会与已在运行的实例争抢监听端口）。
/// </summary>
public static class HealthCheckProbe
{
    /// <summary>执行探测。返回进程退出码：0 表示健康。</summary>
    public static async Task<int> RunAsync(string[] args)
    {
        var probeUrl = args
            .FirstOrDefault(a => a.StartsWith("--probe-url=", StringComparison.Ordinal))?
            .Split('=', 2)[1]
            ?? "http://127.0.0.1:8080/health/live";

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

        try
        {
            using var response = await client.GetAsync(probeUrl);
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (HttpRequestException)
        {
            // 实例尚未监听端口是正常的「不健康」信号，不是探针自身的错误。
            return 1;
        }
        catch (TaskCanceledException)
        {
            return 1;
        }
    }
}
