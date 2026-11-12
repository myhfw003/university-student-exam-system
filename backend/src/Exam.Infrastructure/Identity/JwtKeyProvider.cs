using System.Security.Cryptography;
using System.Text;
using Exam.Infrastructure.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Exam.Infrastructure.Identity;

/// <summary>
/// JWT 签名密钥提供器。签发方与校验方共用同一实例，保证密钥一致。
/// <para>未配置私钥时在启动时临时生成一把 RSA 密钥（仅本地开发，重启后已签发令牌失效）。</para>
/// </summary>
public sealed class JwtKeyProvider : IDisposable
{
    private readonly RSA _rsa;

    public JwtKeyProvider(IOptions<JwtOptions> options)
    {
        var settings = options.Value;

        var pem = LoadPrivateKeyPem(settings);

        if (!string.IsNullOrWhiteSpace(pem))
        {
            _rsa = RSA.Create();
            _rsa.ImportFromPem(NormalizePem(pem));
            IsEphemeral = false;
        }
        else
        {
            _rsa = RSA.Create(2048);
            IsEphemeral = true;
        }

        PublicKey = new RsaSecurityKey(_rsa);
        SigningCredentials = new SigningCredentials(PublicKey, SecurityAlgorithms.RsaSha256);
    }

    public RsaSecurityKey PublicKey { get; }

    public SigningCredentials SigningCredentials { get; }

    /// <summary>是否为临时生成的开发密钥。</summary>
    public bool IsEphemeral { get; }

    public void Dispose() => _rsa.Dispose();

    /// <summary>
    /// 按优先级读取私钥：文件路径 → Base64 → 内联 PEM。
    /// 三种形式覆盖不同的部署方式，优先级从「最不易被中间层破坏」到「最易被破坏」排列。
    /// </summary>
    private static string? LoadPrivateKeyPem(JwtOptions settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.SigningPrivateKeyPemFile))
        {
            var path = settings.SigningPrivateKeyPemFile.Trim();
            if (File.Exists(path))
            {
                return File.ReadAllText(path);
            }
        }

        if (!string.IsNullOrWhiteSpace(settings.SigningPrivateKeyPemBase64))
        {
            var encoded = settings.SigningPrivateKeyPemBase64.Trim();
            try
            {
                return Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
            }
            catch (FormatException ex)
            {
                throw new InvalidOperationException(
                    "Jwt:SigningPrivateKeyPemBase64 不是合法的 Base64 内容。", ex);
            }
        }

        return settings.SigningPrivateKeyPem;
    }

    /// <summary>
    /// 归一化 PEM：把字面量 "\n" 还原成真实换行，并统一 CRLF。
    /// 环境变量里的多行 PEM 常被转义成字面 \n，直接交给 ImportFromPem 会失败。
    /// </summary>
    private static string NormalizePem(string pem)
    {
        var normalized = pem.Replace("\\n", "\n").Replace("\r\n", "\n");
        return normalized.Trim();
    }
}
