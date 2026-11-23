using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Services;
using Exam.Application.Settings.Services;
using Exam.Application.UnitTests.Identity;
using Exam.Domain.Learning;
using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Abstractions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Settings;

/// <summary>系统级设置的取值与回退。</summary>
public sealed class SystemSettingsResolverTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 21, 2, 0, 0, TimeSpan.Zero);

    private readonly ISystemSettingRepository _settings = Substitute.For<ISystemSettingRepository>();

    [Fact]
    public async Task 没配过就按默认口径()
    {
        Given(null);

        (await Resolver().GetMistakeResolutionPolicyAsync())
            .ShouldBe(MistakeResolutionPolicy.Remove);
    }

    [Fact]
    public async Task 配了就按配的来()
    {
        Given("keep_mastered");

        (await Resolver().GetMistakeResolutionPolicyAsync())
            .ShouldBe(MistakeResolutionPolicy.KeepMastered);
    }

    [Fact]
    public async Task 没配原始密码就取不到哈希()
    {
        GivenOriginalPasswordHash(null);

        (await Resolver().GetOriginalPasswordHashAsync()).ShouldBeNull();
    }

    [Fact]
    public async Task 配了原始密码就取得到哈希()
    {
        GivenOriginalPasswordHash("hash-of-original");

        (await Resolver().GetOriginalPasswordHashAsync()).ShouldBe("hash-of-original");
    }

    [Fact]
    public async Task 认不出来的取值回退到默认口径()
    {
        Given("乱写");

        (await Resolver().GetMistakeResolutionPolicyAsync())
            .ShouldBe(MistakeResolutionPolicy.Remove);
    }

    private SystemSettingsResolver Resolver() => new(_settings);

    private void GivenOriginalPasswordHash(string? hash)
    {
        var setting = hash is null
            ? null
            : SystemSetting.Create(SystemSettingKeys.OriginalPasswordHash, hash, Now, null);

        _settings
            .GetAsync(SystemSettingKeys.OriginalPasswordHash, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<SystemSetting?>(setting));
    }

    private void Given(string? value)
    {
        var setting = value is null
            ? null
            : SystemSetting.Create(SystemSettingKeys.MistakeResolutionPolicy, value, Now, null);

        _settings
            .GetAsync(SystemSettingKeys.MistakeResolutionPolicy, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<SystemSetting?>(setting));
    }
}

/// <summary>「已掌握」按系统级设置处理。</summary>
public sealed class MistakeResolutionServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 21, 2, 0, 0, TimeSpan.Zero);

    private readonly ISystemSettingRepository _settings = Substitute.For<ISystemSettingRepository>();
    private readonly IMistakeRepository _mistakes = Substitute.For<IMistakeRepository>();
    private readonly IClock _clock = new FixedClock(Now);

    [Fact]
    public async Task 默认口径把记录移出错题本()
    {
        Given(null);

        var mistake = NewMistake();
        var policy = await Service().ResolveAsync(mistake);

        policy.ShouldBe(MistakeResolutionPolicy.Remove);
        mistake.IsDeleted.ShouldBeTrue();
        mistake.ResolvedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task 保留口径只标记已掌握()
    {
        Given("keep_mastered");

        var mistake = NewMistake();
        var policy = await Service().ResolveAsync(mistake);

        policy.ShouldBe(MistakeResolutionPolicy.KeepMastered);
        mistake.IsDeleted.ShouldBeFalse();
        mistake.ResolvedAt.ShouldNotBeNull();
    }

    private MistakeResolutionService Service() =>
        new(_mistakes, new SystemSettingsResolver(_settings), _clock);

    private static Mistake NewMistake() =>
        Mistake.Record(1, 2, MistakeReason.SingleWrong, MistakeSourceType.Exam, 3, Now);

    private void Given(string? value)
    {
        var setting = value is null
            ? null
            : SystemSetting.Create(SystemSettingKeys.MistakeResolutionPolicy, value, Now, null);

        _settings
            .GetAsync(SystemSettingKeys.MistakeResolutionPolicy, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<SystemSetting?>(setting));
    }
}
