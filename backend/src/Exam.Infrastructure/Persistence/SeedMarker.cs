namespace Exam.Infrastructure.Persistence;

/// <summary>种子执行标记。用于保证种子作业幂等，重复执行安全。</summary>
public sealed class SeedMarker
{
    public SeedMarker()
    {
    }

    private SeedMarker(string name, DateTimeOffset appliedAt)
    {
        Name = name;
        AppliedAt = appliedAt;
    }

    public int Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public DateTimeOffset AppliedAt { get; private set; }

    public static SeedMarker Create(string name, DateTimeOffset appliedAt) => new(name, appliedAt);
}
