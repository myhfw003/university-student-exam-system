namespace Exam.Application.Common.Interfaces;

public interface IUserTagRepository
{
    Task AddAsync(Exam.Domain.Identity.UserTag userTag, CancellationToken cancellationToken = default);

    void Remove(Exam.Domain.Identity.UserTag userTag);

    /// <summary>取回用户挂载的全部组织标签关联。</summary>
    Task<IReadOnlyList<Exam.Domain.Identity.UserTag>> GetByUserAsync(
        long userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量取回多个用户挂载的组织标签关联。
    /// <para>管理端用户列表要展示组织归属，逐个取会变成 N+1 查询。</para>
    /// </summary>
    Task<IReadOnlyList<Exam.Domain.Identity.UserTag>> GetByUsersAsync(
        IReadOnlyCollection<long> userIds,
        CancellationToken cancellationToken = default);

    /// <summary>取回挂载了指定标签的用户 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetUserIdsByTagAsync(long tagId, CancellationToken cancellationToken = default);

    /// <summary>统计挂载了指定标签的用户数量。</summary>
    Task<int> CountByTagAsync(long tagId, CancellationToken cancellationToken = default);
}
