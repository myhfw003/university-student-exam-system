using Exam.Domain.Identity;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class UsernamePolicyTests
{
    [Theory]
    [InlineData("zhangsan")]
    [InlineData("2023120101")]
    [InlineData("lilei_2024")]
    [InlineData("a.b-c")]
    public void IsValid_合规账号_通过(string username) =>
        UsernamePolicy.IsValid(username).ShouldBeTrue();

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData("这个账号带中文")]
    [InlineData("user name")]
    [InlineData("user@host")]
    public void IsValid_不合规账号_不通过(string username) =>
        UsernamePolicy.IsValid(username).ShouldBeFalse();

    [Fact]
    public void IsValid_超过长度上限_不通过() =>
        UsernamePolicy.IsValid(new string('a', 33)).ShouldBeFalse();
}
