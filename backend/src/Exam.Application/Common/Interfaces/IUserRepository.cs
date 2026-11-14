using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按账号查询，忽略大小写。</summary>
    Task<User?> GetByUsernameAsync(string username, CancellationToken cancellationToken = default);

    Task AddAsync(User user, CancellationToken cancellationToken = default);

    void Update(User user);

    /// <summary>
    /// 分页查询用户。支持按账号 / 姓名关键词、状态与角色过滤。
    /// 排序固定为「更新时间倒序 + 主键兜底」，保证分页结果稳定。
    /// </summary>
    Task<IReadOnlyList<User>> SearchAsync(
        string? keyword,
        UserStatus? status,
        long? roleId,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        string? keyword,
        UserStatus? status,
        long? roleId,
        CancellationToken cancellationToken = default);

    /// <summary>取回拥有指定角色的全部用户 ID。</summary>
    Task<IReadOnlyList<long>> GetUserIdsByRoleAsync(long roleId, CancellationToken cancellationToken = default);
}
