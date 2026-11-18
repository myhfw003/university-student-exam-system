namespace Exam.Domain.Identity;

public enum UserStatus
{
    Active,
    Locked,
    Disabled,
}

/// <summary>
/// 用户状态的存储值。
/// <para>
/// 列表接口与档案修改接口必须用同一套取值：读回来的值原样写回去要能通过校验，
/// 否则「读—改—写」这一圈就会断在半路。
/// </para>
/// </summary>
public static class UserStatuses
{
    public static string ToStorage(this UserStatus status) => status switch
    {
        UserStatus.Active => "active",
        UserStatus.Locked => "locked",
        UserStatus.Disabled => "disabled",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "未知用户状态。"),
    };
}
