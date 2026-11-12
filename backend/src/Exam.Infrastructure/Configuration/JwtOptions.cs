namespace Exam.Infrastructure.Configuration;

/// <summary>
/// JWT 配置。密钥只从环境变量注入，不落在 appsettings.json 中。
/// </summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "exam";

    public string Audience { get; set; } = "exam-web";

    /// <summary>
    /// RS256 私钥 PEM（内联形式）。
    /// 未配置时本地开发会临时生成一把（重启后令牌失效）。
    /// </summary>
    public string? SigningPrivateKeyPem { get; set; }

    /// <summary>
    /// RS256 私钥 PEM 文件路径。容器部署推荐用这个：PEM 含多行，
    /// 走环境变量时换行容易被转义成字面 \n 导致解析失败；挂载文件没有这个问题。
    /// </summary>
    public string? SigningPrivateKeyPemFile { get; set; }

    /// <summary>
    /// RS256 私钥 PEM 的 Base64 形式（单行，容器环境变量注入的推荐方式）。
    /// Base64 本身不含换行与转义字符，经过 compose / K8s Secret 传递不会变形。
    /// </summary>
    public string? SigningPrivateKeyPemBase64 { get; set; }

    /// <summary>RS256 公钥 PEM。</summary>
    public string? SigningPublicKeyPem { get; set; }

    public int AccessTokenMinutes { get; set; } = 15;

    public int RefreshTokenDays { get; set; } = 7;

    /// <summary>刷新令牌哈希的 HMAC 密钥（pepper）。生产环境必须配置。</summary>
    public string RefreshTokenPepper { get; set; } = string.Empty;
}
