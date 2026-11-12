using System.Security.Cryptography;
using System.Text;
using Exam.Infrastructure.Configuration;
using Exam.Infrastructure.Identity;
using Microsoft.Extensions.Options;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Identity;

/// <summary>
/// 签名私钥的注入与解析。回归 P0 缺陷 12：
/// 多行 PEM 经环境变量传递时换行被转义成字面 \n，导致 ImportFromPem 失败、
/// API 容器启动即崩溃。
/// </summary>
public sealed class JwtKeyProviderTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("exam-jwt-key-").FullName;

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }

    private static string GeneratePem()
    {
        using var rsa = RSA.Create(2048);
        return new string(PemEncoding.Write("PRIVATE KEY", rsa.ExportPkcs8PrivateKey()));
    }

    private static JwtKeyProvider Create(JwtOptions options) =>
        new(Options.Create(options));

    [Fact]
    public void 未配置任何私钥时生成临时密钥()
    {
        using var provider = Create(new JwtOptions());

        provider.IsEphemeral.ShouldBeTrue();
    }

    [Fact]
    public void 内联PEM可正常解析()
    {
        using var provider = Create(new JwtOptions { SigningPrivateKeyPem = GeneratePem() });

        provider.IsEphemeral.ShouldBeFalse();
        provider.SigningCredentials.Algorithm.ShouldBe("RS256");
    }

    [Fact]
    public void 内联PEM中的字面转义换行可被归一化()
    {
        // 环境变量里的多行 PEM 常见形态：换行变成字面 \n 两字符序列。
        var escaped = GeneratePem().Replace("\n", "\\n");

        using var provider = Create(new JwtOptions { SigningPrivateKeyPem = escaped });

        provider.IsEphemeral.ShouldBeFalse();
    }

    [Fact]
    public void Base64形式私钥可正常解析()
    {
        var base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(GeneratePem()));

        using var provider = Create(new JwtOptions { SigningPrivateKeyPemBase64 = base64 });

        provider.IsEphemeral.ShouldBeFalse();
    }

    [Fact]
    public void Base64形式私钥内容非法时抛出明确异常()
    {
        var options = new JwtOptions { SigningPrivateKeyPemBase64 = "这不是-合法-Base64-!!" };

        var exception = Should.Throw<InvalidOperationException>(() => Create(options));

        exception.Message.ShouldContain("Base64");
    }

    [Fact]
    public void 文件形式私钥可正常解析()
    {
        var path = Path.Combine(_tempDir, "jwt-private.pem");
        File.WriteAllText(path, GeneratePem());

        using var provider = Create(new JwtOptions { SigningPrivateKeyPemFile = path });

        provider.IsEphemeral.ShouldBeFalse();
    }

    [Fact]
    public void 私钥文件不存在时回退到Base64()
    {
        var base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(GeneratePem()));
        var options = new JwtOptions
        {
            SigningPrivateKeyPemFile = Path.Combine(_tempDir, "不存在.pem"),
            SigningPrivateKeyPemBase64 = base64,
        };

        using var provider = Create(options);

        provider.IsEphemeral.ShouldBeFalse();
    }

    [Fact]
    public void 文件形式优先于Base64形式()
    {
        var filePath = Path.Combine(_tempDir, "jwt-private.pem");
        File.WriteAllText(filePath, GeneratePem());

        // 两份不同密钥：文件优先时公钥必须等于文件里那把。
        var fileKey = File.ReadAllText(filePath);
        using var expected = RSA.Create();
        expected.ImportFromPem(fileKey);

        var otherBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(GeneratePem()));
        var options = new JwtOptions
        {
            SigningPrivateKeyPemFile = filePath,
            SigningPrivateKeyPemBase64 = otherBase64,
        };

        using var provider = Create(options);
        using var actual = RSA.Create();
        actual.ImportSubjectPublicKeyInfo(
            provider.PublicKey.Rsa.ExportSubjectPublicKeyInfo(),
            out _);

        actual.ExportParameters(false).Modulus.ShouldBe(expected.ExportParameters(false).Modulus);
    }
}
