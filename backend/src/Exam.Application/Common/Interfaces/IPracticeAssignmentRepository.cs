using Exam.Domain.Learning;

namespace Exam.Application.Common.Interfaces;

/// <summary>练习开放单。</summary>
public interface IPracticeAssignmentRepository
{
    Task<PracticeAssignment?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task AddAsync(PracticeAssignment assignment, CancellationToken cancellationToken = default);
}
