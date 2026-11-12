using Exam.Domain.Identity;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class PasswordPolicyTests
{
    [Theory]
    [InlineData("Passw0rd!")]
    [InlineData("abcdefgh12")]
    [InlineData("ABCDEFGH12")]
    public void Validate_合规密码_通过(string password) =>
        PasswordPolicy.Validate(password, "zhangsan").ShouldBeEmpty();

    [Fact]
    public void Validate_过短_不通过() =>
        PasswordPolicy.Validate("a1", "zhangsan").ShouldNotBeEmpty();

    [Fact]
    public void Validate_缺少数字_不通过() =>
        PasswordPolicy.Validate("abcdefgh", "zhangsan").ShouldNotBeEmpty();

    [Fact]
    public void Validate_缺少字母_不通过() =>
        PasswordPolicy.Validate("12345678", "zhangsan").ShouldNotBeEmpty();

    [Fact]
    public void Validate_包含账号_不通过() =>
        PasswordPolicy.Validate("zhangsan123", "zhangsan").ShouldNotBeEmpty();
}
