namespace Exam.Domain.SharedKernel.ValueObjects;

/// <summary>
/// 值对象基类：无标识、由属性定义、不可变。
/// 变更即整体替换，因此不需要单独的 Setter 语义。
/// </summary>
public abstract class ValueObject
{
    protected abstract IEnumerable<object?> GetEqualityComponents();

    public override bool Equals(object? obj) =>
        obj is ValueObject other
        && GetEqualityComponents().SequenceEqual(other.GetEqualityComponents());

    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var component in GetEqualityComponents())
        {
            hash.Add(component);
        }

        return hash.ToHashCode();
    }

    public static bool operator ==(ValueObject? left, ValueObject? right) => Equals(left, right);

    public static bool operator !=(ValueObject? left, ValueObject? right) => !Equals(left, right);
}
