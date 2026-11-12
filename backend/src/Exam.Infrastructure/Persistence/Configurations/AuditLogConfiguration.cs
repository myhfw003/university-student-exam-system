using Exam.Domain.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.ToTable("audit_log", "audit");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Action).HasMaxLength(128).IsRequired();
        builder.Property(x => x.OperatorName).HasMaxLength(64);
        builder.Property(x => x.TargetType).HasMaxLength(64);
        builder.Property(x => x.TargetId).HasMaxLength(128);
        builder.Property(x => x.Summary).HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.IpAddress).HasMaxLength(64);
        builder.Property(x => x.UserAgent).HasMaxLength(512);
        builder.Property(x => x.RequestId).HasMaxLength(64);
        builder.Property(x => x.OccurredAt).IsRequired();

        builder.HasIndex(x => x.OccurredAt).HasDatabaseName("ix_audit_time");
        builder.HasIndex(x => new { x.OperatorId, x.OccurredAt }).HasDatabaseName("ix_audit_operator");
        builder.HasIndex(x => new { x.TargetType, x.TargetId }).HasDatabaseName("ix_audit_target");
    }
}
