using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按账号查询，忽略大小写。</summary>
    Task<User?> GetByUsernameAsync(string username, CancellationToken cancellationToken = default);

    Task AddAsync(User user, CancellationToken cancellationToken = default);

    void Update(User user);
}
