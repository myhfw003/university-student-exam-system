namespace Exam.Domain.SharedKernel.Abstractions;

/// <summary>工作单元抽象。由 Infrastructure 实现（EF Core）。</summary>
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
