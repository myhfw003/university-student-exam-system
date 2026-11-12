namespace Exam.Domain.SharedKernel.Abstractions;

/// <summary>时钟抽象。领域层禁止直接读取 DateTimeOffset.UtcNow，以便测试可注入固定时间。</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}
