using Exam.Domain.Settings;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Settings;

public sealed class SystemSettingTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 21, 2, 0, 0, TimeSpan.Zero);

    [Fact]
    public void 键不能为空()
    {
        Should.Throw<BusinessRuleException>(() =>
            SystemSetting.Create(" ", "remove", Now, null));
    }

    [Fact]
    public void 值不能为空()
    {
        Should.Throw<BusinessRuleException>(() =>
            SystemSetting.Create("k", null!, Now, null));
    }

    [Fact]
    public void 改值()
    {
        var setting = SystemSetting.Create("mistake_resolution_policy", "remove", Now, 7);

        setting.Key.ShouldBe("mistake_resolution_policy");
        setting.Value.ShouldBe("remove");

        setting.SetValue("keep_mastered", Now.AddMinutes(1), 8);

        setting.Value.ShouldBe("keep_mastered");
        setting.UpdatedBy.ShouldBe(8);
    }

    [Fact]
    public void 口径取值往返()
    {
        MistakeResolutionPolicy.Remove.ToStorage().ShouldBe("remove");
        MistakeResolutionPolicy.KeepMastered.ToStorage().ShouldBe("keep_mastered");

        MistakeResolutionPolicies.FromStorage("remove")
            .ShouldBe(MistakeResolutionPolicy.Remove);
        MistakeResolutionPolicies.FromStorage("keep_mastered")
            .ShouldBe(MistakeResolutionPolicy.KeepMastered);
    }

    [Fact]
    public void 认不出来的取值返回空()
    {
        MistakeResolutionPolicies.FromStorage("乱写").ShouldBeNull();
        MistakeResolutionPolicies.FromStorage(null).ShouldBeNull();
    }

    [Fact]
    public void 缺省口径是移出错题本()
    {
        MistakeResolutionPolicies.Default.ShouldBe(MistakeResolutionPolicy.Remove);

        MistakeResolutionPolicy.Remove.Label().ShouldBe("移出错题本");
        MistakeResolutionPolicy.KeepMastered.Label().ShouldBe("保留但标记已掌握");
    }
}
