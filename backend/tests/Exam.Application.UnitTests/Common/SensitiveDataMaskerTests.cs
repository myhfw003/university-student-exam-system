using Exam.Application.Common.Security;
using Shouldly;

namespace Exam.Application.UnitTests.Common;

/// <summary>敏感数据脱敏的规则（FR-AUD-02 / 安全合规文档 §8.4）。</summary>
public sealed class SensitiveDataMaskerTests
{
    [Fact]
    public void 手机号_保留前3后4() =>
        SensitiveDataMasker.MaskPhone("13812345678").ShouldBe("138****5678");

    [Fact]
    public void 手机号_短到前3后4会重叠_全掩码() =>
        SensitiveDataMasker.MaskPhone("1234567").ShouldBe("*******");

    [Fact]
    public void 手机号_没有值_原样返回() =>
        SensitiveDataMasker.MaskPhone(null).ShouldBeNull();

    [Fact]
    public void 密码与令牌_全掩码() =>
        SensitiveDataMasker.MaskSecret("Passw0rd!").ShouldBe("***");

    [Fact]
    public void 密码与令牌_没有值_原样返回() =>
        SensitiveDataMasker.MaskSecret(null).ShouldBeNull();

    [Fact]
    public void 邮箱_保留首字符与域名() =>
        SensitiveDataMasker.MaskEmail("linzhiyao@example.edu").ShouldBe("l***@example.edu");

    [Fact]
    public void 邮箱_没有域名_全掩码() =>
        SensitiveDataMasker.MaskEmail("not-an-email").ShouldBe("***");

    [Fact]
    public void 按字段名脱敏_密码与令牌全掩码()
    {
        SensitiveDataMasker.MaskFieldValue("PasswordHash", "hash-value").ShouldBe("***");
        SensitiveDataMasker.MaskFieldValue("TokenHash", "hash-value").ShouldBe("***");
        SensitiveDataMasker.MaskFieldValue("Password", null).ShouldBeNull();
    }

    [Fact]
    public void 按字段名脱敏_手机号与邮箱()
    {
        SensitiveDataMasker.MaskFieldValue("Phone", "13812345678").ShouldBe("138****5678");
        SensitiveDataMasker.MaskFieldValue("Email", "lin@example.edu").ShouldBe("l***@example.edu");
    }

    [Fact]
    public void 按字段名脱敏_其它字段原样()
    {
        SensitiveDataMasker.MaskFieldValue("DisplayName", "张三").ShouldBe("张三");
        SensitiveDataMasker.MaskFieldValue("FailedLoginCount", 3).ShouldBe(3);
    }
}
