using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Exam.Web.Security;

/// <summary>
/// 客户端地址（来源 IP）的取法。
/// <para>
/// 限流的分区键与审计记的 IP 都取自这里，两处必须一致：
/// 同一台机器经代理与直连两条路进来时，如果一个记成 <c>a.b.c.d</c>、另一个记成
/// <c>::ffff:a.b.c.d</c>，它就落进两个不同的限流桶，额度凭空翻倍，审计里也是两条记录。
/// </para>
/// </summary>
public static class ClientAddress
{
    /// <summary>
    /// 把地址归一成字符串：IPv4 映射的 IPv6（<c>::ffff:a.b.c.d</c>）取回 <c>a.b.c.d</c>。
    /// <para>
    /// 直连进来的对端地址在 .NET 里是 IPv4 映射的 IPv6，经反向代理转发头处理过的
    /// 是干净的 IPv4。归一之后两条路给出同一个键。
    /// </para>
    /// </summary>
    public static string? Normalize(IPAddress? address)
    {
        if (address is null)
        {
            return null;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        return address.ToString();
    }

    /// <summary>当前进程是否跑在容器里。</summary>
    public static bool IsContainer()
    {
        if (File.Exists("/.dockerenv"))
        {
            return true;
        }

        try
        {
            var cgroup = File.ReadAllText("/proc/1/cgroup");
            return cgroup.Contains("docker", StringComparison.Ordinal)
                || cgroup.Contains("containerd", StringComparison.Ordinal)
                || cgroup.Contains("kubepods", StringComparison.Ordinal);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>
    /// 本机自身的 IPv4 网段。
    /// <para>
    /// 跑在容器里时，这就是 compose 的网桥段——反向代理（nginx）与 API 之间那段。
    /// 它是**容器网络**，不是考场局域网：局域网里的机器地址不在这里，
    /// 所以它们的 <c>X-Forwarded-For</c> 不会被采信。
    /// </para>
    /// </summary>
    public static IReadOnlyList<IPNetwork> LocalNetworks()
    {
        var networks = new List<IPNetwork>();

        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            foreach (var unicast in nic.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork)
                {
                    continue;
                }

                var mask = unicast.IPv4Mask;
                if (mask is null)
                {
                    continue;
                }

                var prefix = PrefixLength(mask);
                if (prefix is < 0 or > 32)
                {
                    continue;
                }

                // 取网络地址（不是接口地址）：日志里看到 172.21.0.0/16 比 172.21.0.5/16 清楚。
                networks.Add(new IPNetwork(MaskAddress(unicast.Address, mask), prefix));
            }
        }

        return networks;
    }

    /// <summary>按掩码取网络地址（172.21.0.5/16 → 172.21.0.0）。</summary>
    private static IPAddress MaskAddress(IPAddress address, IPAddress mask)
    {
        var addressBytes = address.GetAddressBytes();
        var maskBytes = mask.GetAddressBytes();
        var result = new byte[addressBytes.Length];

        for (var i = 0; i < addressBytes.Length; i++)
        {
            result[i] = (byte)(addressBytes[i] & maskBytes[i]);
        }

        return new IPAddress(result);
    }

    /// <summary>掩码的前缀长度（255.255.255.0 → 24）。</summary>
    private static int PrefixLength(IPAddress mask)
    {
        var length = 0;

        foreach (var b in mask.GetAddressBytes())
        {
            for (var bit = 7; bit >= 0; bit--)
            {
                if ((b & (1 << bit)) == 0)
                {
                    return length;
                }

                length++;
            }
        }

        return length;
    }
}
