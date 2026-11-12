using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Infrastructure.Time;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
